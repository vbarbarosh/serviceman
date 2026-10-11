const agent_root_socket = require('./agent_root_socket');
const net = require('net');

// One job for the root half of this machine, over its socket: the question is a line of json,
// the answer is lines of json — what the work printed as it printed it, then how it ended.
// One connection is one job, because a socket on the same machine is cheap and a protocol
// that carries two jobs at once is not.
//
// A machine with no root agent says so as `NOROOT`, which is not a failure of the work: it is
// the answer to "may this be done at all here".
function agent_root_ask(options, method, params, say)
{
    const path = agent_root_socket(options);
    return new Promise(function (resolve, reject) {
        const socket = net.connect({path});
        let rest = '';
        let answered = false;
        socket.on('connect', function () {
            socket.write(`${JSON.stringify({method, params: ((params === undefined) ? {} : params)})}\n`);
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
            reject(no_root(error));
        });
        socket.on('close', function () {
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

module.exports = agent_root_ask;
