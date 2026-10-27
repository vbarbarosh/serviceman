const agent_apt_lists_at = require('./agent_apt_lists_at');
const agent_updates = require('./agent_updates');
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const stream = require('stream');
const stream_each = require('@vbarbarosh/node-helpers/src/stream_each');
const stream_lines = require('@vbarbarosh/node-helpers/src/stream_lines');
const stream_terminal_text = require('../../helpers/stream_terminal_text');

// What a person would type, with the answers to its questions given in advance: nothing here
// may stop and wait for a keyboard, because there is nobody at this end of it. A config file
// the machine's owner changed is kept as it is — apt asking about it is apt asking a person.
// --with-new-pkgs installs an update that brings a new package with it, a new kernel's above
// all, which a plain upgrade keeps back for good; nothing is ever removed.
const ANSWERS = '-y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef';
const KEEP_LINES = 200;
const KILL_AFTER_MS = 10000;
// A fetch of the lists still going after this is stopped: apt's own timeouts are a few
// minutes a mirror
const REFRESH_MAX_MS = 10*60*1000;

// Installs what is waiting, saying every line as apt prints it. One run at a time on a
// machine: two apt-gets at once is a lock fight, not twice the work. A fetch of the lists
// going on by itself (refresh) is waited for, since Install fetches them again anyway.
async function agent_apt_upgrade(state, options, say)
{
    if ((state.apt_refresh !== undefined) && (state.apt_refresh !== null)) {
        await state.apt_refresh;
    }
    if ((state.apt !== undefined) && (state.apt !== null)) {
        return {ok: false, stderr: 'apt is already running on this machine'};
    }
    // Both apt-gets are run through whatever this machine says apt-get is — `sudo -n apt-get`
    // where the agent is not root, so a sudoers line may name apt-get and nothing else; a line
    // that named a shell would be root with extra words.
    const apt = apt_command(options);
    const ran = await apt_run(state, `${apt} update && ${apt} ${ANSWERS} upgrade --with-new-pkgs`, say);
    const cancelled = (state.apt_cancelled === true);
    state.apt_cancelled = false;
    // What is waiting has just changed: the next answer is counted again
    agent_updates.recount();
    return {ok: (ran.code === 0), cancelled, code: ran.code, stdout: ran.stdout, stderr: ran.stderr};
}

// apt's package lists fetched again, with nobody asking: what the machine counts as waiting
// is then what Install would find. Not while apt runs for anything else. A fetch that went
// well is marked as apt marks its own daily one, so the lists' age says when apt last looked
// even where no list changed.
//
//     -> {ok, skipped, code, stderr}
function agent_apt_refresh(state, options)
{
    if (((state.apt !== undefined) && (state.apt !== null)) || ((state.apt_refresh !== undefined) && (state.apt_refresh !== null))) {
        return Promise.resolve({ok: false, skipped: true, code: null, stderr: 'apt is already running on this machine'});
    }
    const base = (options.apt_root_dir === undefined) ? '' : options.apt_root_dir;
    const promise = apt_run(state, `${apt_command(options)} -q update`, null, REFRESH_MAX_MS).then(function (ran) {
        // Stopped by a Cancel meant for Install: that Install is not this
        state.apt_cancelled = false;
        if (ran.code === 0) {
            stamp_touch(path.join(base, agent_apt_lists_at.STAMP));
        }
        agent_updates.recount();
        return {ok: (ran.code === 0), skipped: false, code: ran.code, stderr: ran.stderr};
    }).finally(function () {
        state.apt_refresh = null;
    });
    state.apt_refresh = promise;
    return promise;
}

// A shell line of apt-gets, its lines kept and said as they come. state.apt is the run going
// from the first moment to the last, so nothing else starts apt meanwhile.
//
//     -> {code, stdout, stderr}: the last lines of each
function apt_run(state, line, say, max_ms)
{
    const child = child_process.spawn('/bin/sh', ['-c', line], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: Object.assign({}, process.env, {DEBIAN_FRONTEND: 'noninteractive'}),
    });
    state.apt = child;
    const timer = (max_ms === undefined) ? null : setTimeout(() => kill(child.pid, 'SIGKILL'), max_ms);
    const kept = {stdout: [], stderr: []};
    function read(name, source) {
        return stream.promises.pipeline(source, stream_terminal_text(), stream_lines(), stream_each(function (text) {
            kept[name].push(text);
            if (kept[name].length > KEEP_LINES) {
                kept[name].shift();
            }
            if ((say !== undefined) && (say !== null) && (text.trim() !== '')) {
                say(name, text);
            }
        }));
    }
    const done = new Promise(function (resolve) {
        child.once('error', function (error) {
            kept.stderr.push(error.message);
            resolve(-1);
        });
        child.once('close', function (code) {
            resolve(code);
        });
    });
    return Promise.all([done, read('stdout', child.stdout), read('stderr', child.stderr)]).then(function (all) {
        clearTimeout(timer);
        state.apt = null;
        return {code: all[0], stdout: kept.stdout.join('\n').trim(), stderr: kept.stderr.join('\n').trim()};
    });
}

// Touched as `touch` does: made where it is missing, its time now where it is not
function stamp_touch(file)
{
    try {
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.closeSync(fs.openSync(file, 'a'));
        const now = new Date();
        fs.utimesSync(file, now, now);
    }
    catch {
        // The lists are fetched all the same; their folder's time says it a little less well
    }
}

// What apt-get is on this machine: as given, or with sudo in front of it where the agent is
// not root — which is every machine where it runs as the person who logs in
function apt_command(options)
{
    if ((options !== undefined) && (options.apt !== undefined) && (options.apt !== '')) {
        return options.apt;
    }
    return ((process.getuid !== undefined) && (process.getuid() === 0)) ? 'apt-get' : 'sudo -n apt-get';
}

// Stops the run that is going: the whole group, because apt is a shell line that started
// others. It is asked first the way ctrl-c asks, and made to stop if it will not.
function agent_apt_cancel(state)
{
    const child = state.apt;
    if ((child === undefined) || (child === null)) {
        return {stopped: false, reason: 'nothing is being installed on this machine'};
    }
    state.apt_cancelled = true;
    kill(child.pid, 'SIGINT');
    setTimeout(function () {
        if (state.apt === child) {
            kill(child.pid, 'SIGKILL');
        }
    }, KILL_AFTER_MS);
    return {stopped: true};
}

function kill(pid, signal)
{
    try {
        process.kill(-pid, signal);
    }
    catch {
        try {
            process.kill(pid, signal);
        }
        catch {
            // It ended between the looking and the signalling, which is the outcome anyway
        }
    }
}

agent_apt_upgrade.cancel = agent_apt_cancel;
agent_apt_upgrade.refresh = agent_apt_refresh;

module.exports = agent_apt_upgrade;
