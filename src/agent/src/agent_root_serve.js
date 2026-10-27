const agent_apt = require('./agent_apt');
const agent_built = require('./agent_built');
const agent_disk_usage = require('./agent_disk_usage');
const agent_port_list = require('./agent_port_list');
const agent_root_refresh = require('./agent_root_refresh');
const agent_root_socket = require('./agent_root_socket');
const agent_say = require('./agent_say');
const agent_security_sshd = require('./agent_security_sshd');
const agent_shared = require('./agent_shared');
const agent_ufw = require('./agent_ufw');
const agent_volume = require('./agent_volume');
const child_process = require('child_process');
const fs = require('fs');
const log_uid = require('../../helpers/log_uid');
const net = require('net');

const SOCKET_MODE = 0o600;
// How often the root half looks over its shared folders: what should be mounted and is not,
// after a reboot or a home that was away, is mounted again
const SHARED_KEEP_MS = 60000;
const SHARED_FIRST_MS = 5000;

// The root half of one machine. It dials nowhere and listens on nothing but a file: no port,
// no link, no way in from another machine at all. What may reach it is whatever may open that
// file, which is the agent running in the person's own session — and that is the whole of the
// permission. Being root is what it is for: nothing here runs sudo, and no line in sudoers
// says which commands are allowed, because the answer is "the ones written below".
function agent_root_serve(options)
{
    const path = agent_root_socket(options);
    const boot = log_uid();
    const state = {};
    agent_say(boot, 'group_spawn', undefined);
    stale_remove(path);
    const server = net.createServer(function (socket) {
        job_read(state, options, socket, boot);
    });
    server.on('error', function (error) {
        agent_say(boot, 'root_error', {reason: error.message});
        process.exit(1);
    });
    server.listen(path, function () {
        const owner = owner_set(path, options);
        agent_say(boot, 'root_begin', {socket: path, user: owner, root: (process.getuid !== undefined) && (process.getuid() === 0)});
        shared_keep_start(options, boot);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, function () {
            stale_remove(path);
            process.exit(0);
        });
    }
}

// Who may ask. The socket is the permission, so it is given to one person by name — the one
// whose session runs the agent — and to nobody else.
function owner_set(path, options)
{
    fs.chmodSync(path, SOCKET_MODE);
    const user = (options.root_for === '') ? (process.env.SUDO_USER || '') : options.root_for;
    if (user === '') {
        return null;
    }
    try {
        const uid = parseInt(child_process.execFileSync('id', ['-u', user], {encoding: 'utf8'}).trim(), 10);
        const gid = parseInt(child_process.execFileSync('id', ['-g', user], {encoding: 'utf8'}).trim(), 10);
        fs.chownSync(path, uid, gid);
        return user;
    }
    catch {
        // Not root, or no such person here: the socket keeps the owner it was made with, and
        // the line above says who that is
        return null;
    }
}

// The shared folders this machine was told to mount, kept mounted with nobody asking: at the
// start, which after a reboot is when nothing is, and on the minute. A try that changes nothing
// says nothing; one that fails says so once per reason.
function shared_keep_start(options, group)
{
    let said = null;
    async function keep() {
        try {
            const answer = await agent_shared(options, {action: 'keep'}, function (stream, text) {
                agent_say(group, 'root_shared_keep_line', {text});
            });
            const failed = (answer.ok === false) ? answer.error : answer.items.filter(v => v.state === 'error').map(v => v.error).join('; ');
            if ((failed !== '') && (failed !== said)) {
                agent_say(group, 'root_shared_keep_error', {reason: failed});
            }
            said = failed;
        }
        catch (error) {
            if (error.message !== said) {
                agent_say(group, 'root_shared_keep_error', {reason: error.message});
            }
            said = error.message;
        }
    }
    setTimeout(keep, SHARED_FIRST_MS);
    setInterval(keep, SHARED_KEEP_MS).unref();
}

// What keeps this half up, taken away. Nothing else on the machine is touched: the unit is
// this program's own, and the folder it runs from belongs to the session half, which removes
// it after this one has gone.
function unit_gone()
{
    const unit = '/etc/systemd/system/serviceman-agent-root.service';
    try {
        child_process.execFileSync('systemctl', ['disable', '--now', 'serviceman-agent-root'], {stdio: 'ignore'});
    }
    catch {
        // Not under systemd, or already disabled; the file below is what is left
    }
    try {
        fs.unlinkSync(unit);
        child_process.execFileSync('systemctl', ['daemon-reload'], {stdio: 'ignore'});
        return {unit: 'taken away'};
    }
    catch (error) {
        return {unit: `left as it is — ${error.message}`};
    }
}

// A socket file left behind by a copy that is gone. Nothing else may be removed: a path that
// is not a socket is somebody's file, and this one refuses to start rather than eat it.
function stale_remove(path)
{
    try {
        if (fs.statSync(path).isSocket()) {
            fs.unlinkSync(path);
        }
    }
    catch {
        // It is not there, which is how it should be
    }
}

// One connection is one job: a line of json says what to do, and everything after it belongs
// to that job alone
function job_read(state, options, socket, group)
{
    let rest = '';
    socket.on('error', function () {
        // The asker went; the job below ends with the socket it was asked over
    });
    socket.on('data', function on_data(chunk) {
        rest += chunk.toString('utf8');
        const at = rest.indexOf('\n');
        if (at === -1) {
            return;
        }
        socket.off('data', on_data);
        const job = job_from_line(rest.slice(0, at));
        if (job === null) {
            reply(socket, false, undefined, 'that is not a job this agent can read');
            return;
        }
        job_run(state, options, socket, job, group);
    });
}

function job_run(state, options, socket, job, group)
{
    function say(stream, text) {
        line_send(socket, stream, text);
    }
    agent_say(group, 'root_job_begin', {method: job.method});
    const promise = method_run(state, options, job, say);
    promise.then(function (value) {
        agent_say(group, 'root_job_end_ok', {method: job.method});
        reply(socket, true, value, undefined);
    }, function (error) {
        agent_say(group, 'root_job_end_error', {method: job.method, reason: error.message});
        reply(socket, false, undefined, error.message);
    });
}

async function method_run(state, options, job, say)
{
    const method = String(job.method);
    job.params = ((job.params === undefined) || (job.params === null)) ? {} : job.params;
    if (method === 'ping') {
        return {
            at: Date.now(),
            root: (process.getuid !== undefined) && (process.getuid() === 0),
            built: agent_built,
            // Whether something starts it again when it stops. systemd says so by name, and a
            // copy run by hand from a terminal says no — it is never asked to step aside for a
            // new file, because nothing would bring it back.
            supervised: (process.env.INVOCATION_ID !== undefined) && (process.env.SERVICEMAN_ROOT_SUPERVISED !== 'no'),
        };
    }
    if (method === 'restart') {
        // An update replaced the session half's file. This half takes it as its own copy when
        // it is the host's (agent_root_refresh), then ends, and systemd starts the new one —
        // the answer goes first, because after this there is nobody here to answer with.
        const taken = agent_root_refresh(options);
        setTimeout(function () {
            process.exit(0);
        }, 200);
        return Object.assign({stopping: true}, taken);
    }
    if (method === 'port_list') {
        // ss names the holder of a socket only to whoever may read that socket, which for the
        // agent in a person's session is its own and nothing else. Here it is every one on
        // the machine — sshd, resolved, the daemons nobody logs in as.
        return await agent_port_list();
    }
    if (method === 'disk_usage') {
        // du reads only names and sizes, and as the agent's user it cannot read /root,
        // /var/lib/docker or another person's folders: their sizes are the space nobody can find.
        // Here every folder is counted, each one said as du finishes it.
        return await agent_disk_usage.root(job.params, say);
    }
    if (method === 'apt_upgrade') {
        return await agent_apt(state, options, say);
    }
    if (method === 'apt_cancel') {
        return agent_apt.cancel(state);
    }
    if (method === 'ufw') {
        return await agent_ufw(options, job.params);
    }
    if (method === 'security_root') {
        // sshd's own word for what it runs with, and its journal: both are root's to read
        return await agent_security_sshd(options, {root: true});
    }
    if (method === 'volume') {
        return await agent_volume(options, job.params, say);
    }
    if (method === 'shared') {
        return await agent_shared(options, job.params, say);
    }
    if (method === 'uninstall') {
        // The machine has been taken out of the host's config, and the session half is going
        // with it. What keeps this one up is taken away first, then it ends.
        const gone = unit_gone();
        setTimeout(function () {
            process.exit(0);
        }, 200);
        return gone;
    }
    throw new Error(`the root agent knows nothing called ${JSON.stringify(method)}`);
}

function line_send(socket, stream, text)
{
    socket.write(`${JSON.stringify({type: 'line', stream, text})}\n`);
}

function reply(socket, ok, value, error)
{
    socket.write(`${JSON.stringify({type: 'reply', ok, value, error})}\n`);
    socket.end();
}

function job_from_line(line)
{
    try {
        const job = JSON.parse(line);
        return ((job === null) || (typeof job !== 'object') || (typeof job.method !== 'string')) ? null : job;
    }
    catch {
        return null;
    }
}

module.exports = agent_root_serve;
