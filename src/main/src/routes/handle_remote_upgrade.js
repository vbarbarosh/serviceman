const crypto = require('crypto');
const log_event = require('../helpers/log_event');
const log_group_from = require('../helpers/log_group_from');
const remote_attach = require('../helpers/remote_attach');
const remote_join = require('../helpers/remote_join');
const remote_removed_of = require('../helpers/remote_removed_of');

// A machine says which machine it is: its hostname, a container id, anything stable
const RE_MACHINE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

// GET /api/v1/remote (header:authorization, header:serviceman-machine, header:serviceman-tags)
// The door an agent on another machine knocks on. serviceman never dials out: the agent
// dials in, so a box behind NAT or a firewall needs nothing open.
//
// The token says which remote is dialling — it is the one secret each machine holds, so the
// agent needs no name and cannot claim one it has no token for.
function handle_remote_upgrade(app, req, socket, head)
{
    return log_group_from(socket.log_group, function () {
        const out = link_join(app, req, socket, head);
        out.catch(function (error) {
            refuse(app, socket, 500, 'Internal Server Error', error.message, {from: socket.remoteAddress, reason: 'join_failed'});
        });
        return out;
    });
}

async function link_join(app, req, socket, head)
{
    const remote = await remote_of(app, req, socket);
    if (remote === null) {
        return;
    }
    // One agent per token: a second one is refused rather than taking the link from the first,
    // so a stolen token cannot push the real machine out. A link this end has not noticed is
    // dead keeps the door shut until tcp keepalive drops it.
    if (remote.state.socket !== null) {
        refuse(app, socket, 409, 'Conflict', `an agent is already connected as remote ${remote.name}`, {remote: remote.name, from: socket.remoteAddress, reason: 'token_in_use'});
        return;
    }
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: serviceman\r\nserviceman-remote: ${remote.name}\r\nconnection: Upgrade\r\n\r\n`);
    if (head.length > 0) {
        socket.unshift(head);
    }
    remote_attach(app, remote, socket, tags_claimed(req));
}

// Which remote this link belongs to: the one whose token it holds, or — when the config lets a
// machine add itself — a new one it has just become. Anything else is turned away.
async function remote_of(app, req, socket)
{
    const out = remote_find_by_token(app, req.headers.authorization);
    if (out !== null) {
        return out;
    }
    // A machine this host took away while it was not looking. It is told so, in a word it can
    // act on: it stops dialling and takes itself off that machine.
    const gone = remote_removed_of(app, req.headers.authorization);
    if (gone !== null) {
        refuse(app, socket, 410, 'Gone', `remote ${gone.name} was taken out of the config on this host — this machine is not part of it any more`, {remote: gone.name, from: socket.remoteAddress, reason: 'removed'}, 'removed');
        return null;
    }
    if ((app.config.join === null) || (token_same(app.config.join.token, req.headers.authorization) === false)) {
        refuse(app, socket, 403, 'Forbidden', 'no remote in the config holds that token', {from: socket.remoteAddress, reason: 'unknown_token'});
        return null;
    }
    const machine = String(req.headers['serviceman-machine'] || '').trim();
    if (RE_MACHINE.test(machine) === false) {
        refuse(app, socket, 400, 'Bad Request', 'a machine that adds itself must say which machine it is', {from: socket.remoteAddress, reason: 'no_machine'});
        return null;
    }
    return await remote_join(app, machine, tags_claimed(req), socket.remoteAddress);
}

// What the machine says it is. The config decides which of it is kept.
function tags_claimed(req)
{
    return String(req.headers['serviceman-tags'] || '').split(',').map(v => v.trim().toLowerCase()).filter(v => v !== '');
}

// Which remote holds this token. Every remote is compared, and each comparison takes the same
// time, so a wrong token tells the one who sent it nothing about the right one.
function remote_find_by_token(app, header)
{
    let out = null;
    for (const remote of app.remotes) {
        if (token_matches(remote, header)) {
            out = remote;
        }
    }
    return out;
}

// The agent reads the reason before it drops the link, so a wrong token is obvious in its log,
// and this end writes the one line that says a stranger knocked
function refuse(app, socket, status, phrase, text, words, mark)
{
    log_event(app, 'remote_refused', words);
    // A refusal an agent should act on rather than wait out says so in a header of its own:
    // the text is for a person reading a log, this is for the program
    const said = ((mark === undefined) ? '' : `serviceman-refused: ${mark}\r\n`);
    socket.end(`HTTP/1.1 ${status} ${phrase}\r\ncontent-type: text/plain\r\ncontent-length: ${Buffer.byteLength(text)}\r\n${said}connection: close\r\n\r\n${text}`);
}

function token_matches(remote, header)
{
    return token_same(remote.token, header);
}

// The same comparison for every secret on this door, and it takes the same time whether the
// first letter is wrong or the last
function token_same(token, header)
{
    const given = String(header || '').replace(/^Bearer /i, '');
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(token).digest();
    return crypto.timingSafeEqual(a, b);
}

module.exports = handle_remote_upgrade;
