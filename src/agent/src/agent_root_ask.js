const agent_root_socket = require('./agent_root_socket');
const net = require('net');

// How long a ping is given: the root half answers it at once unless its one thread is stopped,
// which a folder that does not answer can do to it (a stat of a stalled sshfs waits in the
// kernel, beyond any signal)
const PING_MS = 5000;
// How long one answer of the root half vouches for it: a job asked within this of the last one
// is not pinged first
const FRESH_MS = 30000;

// The restart of the root half this agent asked for and has not seen end, or null
let held = null;
// When the root half last answered anything, ok or not
let answered_at = 0;

// One job for the root half of this machine. While this agent restarts it, the job waits for
// the new one: for the seconds systemd takes to start it the socket answers nothing, and a
// machine with a root half would be told it has none (agent_root_current).
//
// A ping is given PING_MS to answer, and every other job a ping first when the root half has
// said nothing for FRESH_MS: a root half that has stopped is then said, as ROOTSTUCK, rather
// than waited for forever by each job, the hello and bin/status among them. A job itself has no
// deadline once the root half has answered, for an apt upgrade takes minutes.
async function agent_root_ask(options, method, params, say)
{
    while (held !== null) {
        await held;
    }
    if (method === 'ping') {
        return await agent_root_ask_now(options, method, params, say, PING_MS);
    }
    if (Date.now() - answered_at > FRESH_MS) {
        try {
            await agent_root_ask_now(options, 'ping', {}, undefined, PING_MS);
        }
        catch (error) {
            if (error.code === 'ROOTSTUCK') {
                throw error;
            }
            // No root half, or one that refuses: the job itself says so, as before
        }
    }
    return await agent_root_ask_now(options, method, params, say);
}

// Every ask waits until `promise` settles; what it settles with is its caller's alone
function agent_root_ask_hold(promise)
{
    const settled = promise.then(nothing, nothing).then(function () {
        if (held === settled) {
            held = null;
        }
    });
    held = settled;
    return promise;
}

// The job over the socket, with no wait: the question is a line of json, the answer is lines
// of json — what the work printed as it printed it, then how it ended. One connection is one
// job, because a socket on the same machine is cheap and a protocol that carries two jobs at
// once is not.
//
// A machine with no root agent says so as `NOROOT`, which is not a failure of the work: it is
// the answer to "may this be done at all here". One that does not answer within `deadline_ms`,
// when one is given, says `ROOTSTUCK`.
function agent_root_ask_now(options, method, params, say, deadline_ms)
{
    const path = agent_root_socket(options);
    return new Promise(function (resolve, reject) {
        const socket = net.connect({path});
        let rest = '';
        let answered = false;
        const timer = (deadline_ms === undefined) ? null : setTimeout(function () {
            answered = true;
            socket.destroy();
            reject(stuck(deadline_ms));
        }, deadline_ms);
        socket.on('connect', function () {
            socket.write(`${JSON.stringify({method, params: (params === undefined) ? {} : params})}\n`);
        });
        socket.on('data', function (chunk) {
            rest += chunk.toString('utf8');
            for (;;) {
                const at = rest.indexOf('\n');
                if (at === -1) {
                    return;
                }
                const line = rest.slice(0, at);
                rest = rest.slice(at + 1);
                const message = message_from_line(line);
                if (message === null) {
                    continue;
                }
                if ((message.type === 'line') && (say !== undefined) && (say !== null)) {
                    say(message.stream, message.text);
                    continue;
                }
                if (message.type === 'reply') {
                    answered = true;
                    answered_at = Date.now();
                    clearTimeout(timer);
                    socket.end();
                    if (message.ok) {
                        resolve(message.value);
                        return;
                    }
                    reject(refused(message.error));
                    return;
                }
            }
        });
        socket.on('error', function (error) {
            clearTimeout(timer);
            reject(no_root(error));
        });
        socket.on('close', function () {
            clearTimeout(timer);
            if (answered === false) {
                reject(new Error('the root agent closed without answering'));
            }
        });
    });
}

// A root half from before the work being asked for is, for that work, a machine without one:
// the asker does what it can in its own session instead of failing. The words are the root
// half's own, written in the one place that refuses a method it has never heard of.
function refused(text)
{
    const out = new Error(text);
    if (text.includes('knows nothing called')) {
        out.code = 'NOROOT';
        // There is a root half, older than this agent: the next heartbeat updates it
        out.root_old = true;
    }
    return out;
}

// A root half that took the job and said nothing within the deadline: its thread has stopped
function stuck(deadline_ms)
{
    const out = new Error(`the root agent did not answer in ${deadline_ms/1000}s — it is stuck; sudo systemctl status serviceman-agent-root`);
    out.code = 'ROOTSTUCK';
    return out;
}

// A socket that is not there, or one this user may not open, both mean the same thing: this
// machine has no root half for the agent to ask
function no_root(error)
{
    const out = new Error(`no root agent on this machine — ${error.message}`);
    if (['ENOENT', 'ECONNREFUSED', 'EACCES', 'EPERM'].includes(error.code)) {
        out.code = 'NOROOT';
    }
    return out;
}

function message_from_line(line)
{
    try {
        return JSON.parse(line);
    }
    catch {
        return null;
    }
}

function nothing()
{
}

agent_root_ask.hold = agent_root_ask_hold;
agent_root_ask.now = agent_root_ask_now;

module.exports = agent_root_ask;
