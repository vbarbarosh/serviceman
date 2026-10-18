const agent_install_sh = require('../src/main/src/helpers/agent_install_sh');
const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// A shell opened with su or sudo has no XDG_RUNTIME_DIR: systemctl --user finds no bus there,
// even while the person's own systemd runs at /run/user/<uid>
test('one install line from a su shell: finds the systemd at /run/user/<uid>, lingers with sudo once', function () {
    const run = make_machine({systemd: 'running'});
    const said = run('sh', [run.installer, '--token', 't', '--prefix', run.prefix]);
    assert.match(said, /it needs sudo once/);
    assert.match(said, /the agent is up — systemctl --user status serviceman-agent/);
    assert.doesNotMatch(said, /lingering is off/);
    assert.ok(fs.existsSync(run.unit_file));
    assert.match(run.calls(), /systemctl --user enable --now serviceman-agent XDG=\/run\/user\/\d+/);
    assert.strictEqual(run.calls().match(/^sudo loginctl enable-linger/gm).length, 1, 'the password is asked once');

    assert.match(run('sh', [path.join(run.prefix, 'bin', 'restart')]), /the agent is up/);
    assert.match(run('sh', [path.join(run.prefix, 'bin', 'uninstall')]), /stopped and out of your systemd/);
    assert.ok(!fs.existsSync(run.unit_file));
});

test('one install line with nobody logged in: lingering starts the systemd, and the agent is up', function () {
    const run = make_machine({systemd: 'stopped'});
    const said = run('sh', [run.installer, '--token', 't', '--prefix', run.prefix]);
    assert.match(said, /the agent is up/);
    assert.ok(fs.existsSync(run.unit_file));
});

test('one install line where lingering is on already asks for no password', function () {
    const run = make_machine({systemd: 'stopped', linger: true});
    const said = run('sh', [run.installer, '--token', 't', '--prefix', run.prefix]);
    assert.match(said, /the agent is up/);
    assert.doesNotMatch(run.calls(), /^sudo/m);
});

test('one install line where sudo is refused says what to run, and leaves no unit behind', function () {
    const run = make_machine({systemd: 'stopped', sudo: 'refuse'});
    const said = run('sh', [run.installer, '--token', 't', '--prefix', run.prefix]);
    assert.match(said, /your own systemd does not answer, and lingering could not be turned on/);
    assert.match(said, /run once as root: loginctl enable-linger \S+/);
    assert.match(said, /nothing was installed to keep it up/);
    assert.ok(!fs.existsSync(run.unit_file), 'a unit left behind sends bin/restart into the same wall');
});

test('bin/restart with no bus says so, and points at bin/install', function () {
    const run = make_machine({systemd: 'running', linger: true});
    run('sh', [run.installer, '--token', 't', '--prefix', run.prefix]);
    const restart = path.join(run.prefix, 'bin', 'restart');
    const failed = child_process.spawnSync('sh', [restart], {env: {...run.env, BUS_AT: '/nowhere'}, encoding: 'utf8'});
    assert.strictEqual(failed.status, 1);
    assert.match(failed.stderr, /your own systemd does not answer in this shell — bin\/install says why/);
});

test('one install line keeps the XDG_RUNTIME_DIR a login gave it', function () {
    const run = make_machine({systemd: 'running', linger: true, xdg: '/run/custom'});
    assert.match(run('sh', [run.installer, '--token', 't', '--prefix', run.prefix]), /the agent is up/);
    assert.doesNotMatch(run.calls(), /XDG=\/run\/user\//);
});

// A machine with no node is told so first: before the password --root asks for, before anything
// is written, with the command that puts node in ~/bin for its own processor
test('one install line with no node says so before sudo, writes nothing, and gives the node line', function () {
    const run = make_machine({systemd: 'running', node: false});
    const said = child_process.spawnSync('sh', ['-s', '--', '--token', 't', '--prefix', run.prefix, '--root'], {input: run.script, env: run.env, encoding: 'utf8'});
    assert.strictEqual(said.status, 1);
    assert.match(said.stderr, /^serviceman: no node on this machine — the agent needs it\. Nothing was installed\./);
    assert.match(said.stderr, /mkdir -p ~\/bin && v=v\d+\.\d+\.\d+ && curl -fsSL https:\/\/nodejs\.org\/dist\/\$v\/node-\$v-linux-\w+\.tar\.xz \| tar -xJ -C ~\/bin/);
    assert.doesNotMatch(said.stdout, /sudo/);
    assert.strictEqual(run.calls(), '', 'no sudo, no systemctl');
    assert.ok(!fs.existsSync(run.prefix));

    // The node that line puts in ~/bin is found by the same install line, run again
    fs.mkdirSync(path.join(run.env.HOME, 'bin'));
    fake(path.join(run.env.HOME, 'bin'), 'node', 'exit 0');
    assert.match(run('sh', [run.installer, '--token', 't', '--prefix', run.prefix]), /the agent is up/);
});

// Piped from curl, the shell reads the whole script before running a line of it: an early exit
// no longer closes the pipe under curl ("curl: (23) Failure writing output")
test('install.sh runs nothing until it is read to the end', function () {
    const lines = agent_install_sh('http://127.0.0.1:9').trimEnd().split('\n');
    assert.strictEqual(lines.at(-1), 'main "$@"');
    assert.ok(lines.indexOf('main() {') < lines.findIndex(v => v.startsWith('url=')));
});

// A machine of fakes. systemctl answers --user only at BUS_AT, and only while the user's systemd
// runs: a login started it, or lingering did. loginctl turns lingering on only under sudo. sudo
// asks for a password (so -n fails), or refuses.
function make_machine({systemd, linger = false, sudo = 'password', xdg, node = true})
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-install-'));
    const bin = path.join(dir, 'bin');
    const home = path.join(dir, 'home');
    const log = path.join(dir, 'calls.log');
    const linger_file = path.join(dir, 'linger');
    fs.mkdirSync(bin);
    fs.mkdirSync(home);
    if (linger) {
        fs.writeFileSync(linger_file, '');
    }
    fake(bin, 'curl', 'while [ $# -gt 0 ]; do [ "$1" = -o ] && echo "//" > "$2"; shift; done');
    fake(bin, 'systemctl', [
        'echo "systemctl $* XDG=${XDG_RUNTIME_DIR:-}" >> "$LOG"',
        '[ "${XDG_RUNTIME_DIR:-}" = "$BUS_AT" ] || { echo "Failed to connect to bus" >&2; exit 1; }',
        '[ "$SYSTEMD" = running ] || [ -e "$LINGER" ] || { echo "Failed to connect to bus" >&2; exit 1; }',
    ].join('\n'));
    fake(bin, 'loginctl', [
        'echo "loginctl $*" >> "$LOG"',
        'case "$1" in',
        '    show-user) [ -e "$LINGER" ] && echo Linger=yes || echo Linger=no;;',
        '    enable-linger) [ -n "${UNDER_SUDO:-}" ] || exit 1; touch "$LINGER";;',
        'esac',
    ].join('\n'));
    fake(bin, 'sudo', [
        '[ "$1" = -n ] && exit 1',
        '[ "$FAKE_SUDO" = refuse ] && { echo "sudo: not in the sudoers file" >&2; exit 1; }',
        'echo "sudo $*" >> "$LOG"',
        'UNDER_SUDO=1 exec "$@"',
    ].join('\n'));
    fake(bin, 'sleep', 'exit 0');

    // With no node, the absolute places it is looked for on a real machine are taken out of the
    // script, and PATH holds the fakes and the few tools the script runs: nothing else
    let script = agent_install_sh('http://127.0.0.1:9');
    if (!node) {
        script = script.replace(' /usr/local/bin/node /opt/node/bin/node;', ';');
        for (const tool of ['sh', 'id', 'uname', 'mkdir', 'mv', 'grep', 'cat', 'chmod', 'stat', 'wc']) {
            fs.symlinkSync(child_process.execFileSync('sh', ['-c', `command -v ${tool}`], {encoding: 'utf8'}).trim(), path.join(bin, tool));
        }
    }
    const installer = path.join(dir, 'install.sh');
    fs.writeFileSync(installer, script);

    const env = {
        HOME: home,
        PATH: (node ? [bin, path.dirname(process.execPath), '/usr/bin', '/bin'] : [bin]).join(':'),
        LOG: log,
        LINGER: linger_file,
        SYSTEMD: systemd,
        FAKE_SUDO: sudo,
        BUS_AT: xdg || `/run/user/${process.getuid()}`,
    };
    if (xdg) {
        env.XDG_RUNTIME_DIR = xdg;
    }

    function run(cmd, args) {
        return child_process.execFileSync(cmd, args, {env, encoding: 'utf8'});
    }
    run.env = env;
    run.installer = installer;
    run.script = script;
    run.prefix = path.join(dir, 'agent');
    run.unit_file = path.join(home, '.config', 'systemd', 'user', 'serviceman-agent.service');
    run.calls = function () {
        return fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    };
    return run;
}

function fake(bin, name, body)
{
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, {mode: 0o755});
}
