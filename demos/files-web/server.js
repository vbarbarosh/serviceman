const cli = require('@vbarbarosh/node-helpers/src/cli');
const fs = require('fs');
const http = require('http');
const path = require('path');
const terminal_connect = require('../terminal-client/terminal_connect');
const terminals_list = require('../terminal-client/terminals_list');
const ws = require('ws');

// The page and the two files of xterm it draws with, served from this checkout
const FILES = {
    '/': {file: path.join(__dirname, 'index.html'), type: 'text/html; charset=utf-8'},
    '/xterm.mjs': {file: require.resolve('@xterm/xterm/lib/xterm.mjs'), type: 'text/javascript'},
    '/xterm.css': {file: require.resolve('@xterm/xterm/css/xterm.css'), type: 'text/css'},
    '/addon-fit.mjs': {file: require.resolve('@xterm/addon-fit/lib/addon-fit.mjs'), type: 'text/javascript'},
    '/fs_client.mjs': {file: path.join(__dirname, 'fs_client.mjs'), type: 'text/javascript'},
};
// serviceman's files API, passed through as it is: the page calls the real addresses
const RE_FS = /^\/api\/v1\/remotes\/[^/]+\/fs(\/|$)/;
// The request headers the files API reads; the rest stay here
const FS_HEADERS = ['content-type', 'content-length', 'range', 'accept'];

// Where serviceman's control page is looked for when URL does not say: as bin/run publishes
// it, then the default of its config
const SERVICEMAN_PLACES = [
    {url: 'http://127.0.0.1:3001', how: 'found: serviceman from bin/run'},
    {url: 'http://127.0.0.1:8081', how: 'found: serviceman on its config default'},
];

// The host keys of GitHub and Bitbucket, as they publish them, so the first clone or push asks
// nobody whether to trust them. github.com is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU,
// bitbucket.org SHA256:ybgmFkzwOSotHTHLJgHO0QN8L0xErw6vd0VhFA9m3SM.
const HOST_KEYS = [
    'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
    'bitbucket.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIazEu89wgQZ4bqs3d63QSMzYVa0MuJ2e2gKTKqu+UUO',
];
// How long a terminal keeps the key at most, when nobody ends it
const KEY_HOURS = 8;
const RE_PRIVATE_KEY = /^-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----\s*$/;

// terminal-web-ssh with the machine's files beside the terminal, for a developer to see how the
// files API is used: the page calls it at its real addresses, which this server passes through
// to serviceman, and shows each request and its answer. The calls themselves are in
// fs_client.mjs. The terminals and the key work as in terminal-web-ssh.
//
//     node demos/files-web/server.js
//
// Nothing has to be set: it finds serviceman, opens on its first machine, and says at start
// what it settled on. PORT, URL and ?remote=<machine> choose otherwise. SERVICEMAN_TOKEN is
// the token serviceman wants, which bin/owner-token prints; this server sends it on every
// request there, and never the page's own cookie.
cli(main);

async function main()
{
    const port = parseInt(process.env.PORT || '8092', 10);
    const target = await serviceman_find();
    target.key = null;
    const server = http.createServer(function (req, res) {
        handle(target, req, res).catch(function (error) {
            send_json(res, 502, {error: unreachable(target.url, error)});
        });
    });
    const sockets = new ws.WebSocketServer({server, path: '/term'});
    sockets.on('connection', (client, req) => join(target.url, client, req));
    await new Promise(v => server.listen(port, '127.0.0.1', v));
    console.log('files-web');
    console.log(`    page        http://127.0.0.1:${port}/    (${(process.env.PORT === undefined) ? 'PORT, 8092 by default' : 'PORT'})`);
    console.log(`    serviceman  ${target.url}    (${target.how})`);
    console.log(`    token       ${token_given() ? 'given' : 'none'}    (SERVICEMAN_TOKEN${token_given() ? '' : '; bin/owner-token prints the owner\'s'})`);
    console.log(`    machine     ${(target.remote === null) ? 'none listed yet' : target.remote}    (${(target.remotes.length > 1) ? `the first of ${target.remotes.join(', ')}; ` : ''}?remote=<name> opens another)`);
    if (target.answered === false) {
        console.log('    nothing answers there yet: the page waits for serviceman to start');
    }
    if (target.refused) {
        console.log(`    ${token_wanted()}`);
    }
    await new Promise(v => server.on('close', v));
}

// URL when it is set; otherwise the first place serviceman answers. Asked again on each
// request while it has not answered, so serviceman may start after this.
async function serviceman_find()
{
    if (process.env.URL !== undefined) {
        return Object.assign({url: process.env.URL, how: 'URL'}, await serviceman_ask(process.env.URL));
    }
    for (const place of SERVICEMAN_PLACES) {
        const found = await serviceman_ask(place.url);
        if (found.answered) {
            return Object.assign({}, place, found);
        }
    }
    return Object.assign({url: SERVICEMAN_PLACES[0].url, how: `not found at ${SERVICEMAN_PLACES.map(v => v.url).join(' or ')}; URL= to name it`}, await serviceman_ask(SERVICEMAN_PLACES[0].url));
}

// Whether serviceman answers there, whether it refused the token, and the machines it knows
async function serviceman_ask(url)
{
    try {
        const answer = await fetch(new URL('/api/v1/status', url), {headers: token_headers({}), signal: AbortSignal.timeout(2000)});
        if (answer.status === 401) {
            return {answered: true, refused: true, remotes: [], remote: null};
        }
        const body = await answer.json();
        const remotes = Array.isArray(body.remotes) ? body.remotes.map(v => v.name) : [];
        return {answered: Array.isArray(body.remotes), refused: false, remotes, remote: (remotes.length === 0) ? null : remotes[0]};
    }
    catch {
        return {answered: false, refused: false, remotes: [], remote: null};
    }
}

// GET  /                          the page
// GET  /defaults                  the machine the page opens on when the address names none
// GET  /terminals?remote=         the terminals kept on that machine
// POST /end?remote=&name=         ends one
// GET  /key                       whether a key is kept, and its kind
// POST /key (body)                the private key the next terminals get; an empty body forgets it
// POST /create?remote=&name=      a terminal made, with the key in its ssh-agent when one is kept
// *    /api/v1/remotes/<name>/fs…  serviceman's files API, passed through
async function handle(target, req, res)
{
    if ((target.answered === false) || target.refused) {
        Object.assign(target, await serviceman_find(), {key: target.key});
    }
    const url = target.url;
    const address = new URL(req.url, 'http://x');
    if (RE_FS.test(address.pathname)) {
        await pass_through(url, req, res);
        return;
    }
    const found = FILES[address.pathname];
    if ((found !== undefined) && (req.method === 'GET')) {
        res.writeHead(200, {'content-type': found.type});
        fs.createReadStream(found.file).pipe(res);
        return;
    }
    if ((address.pathname === '/defaults') && (req.method === 'GET')) {
        send_json(res, 200, {remote: target.remote});
        return;
    }
    if ((address.pathname === '/key') && (req.method === 'GET')) {
        send_json(res, 200, key_said(target.key));
        return;
    }
    if ((address.pathname === '/key') && (req.method === 'POST')) {
        const text = (await body_read(req)).replace(/\r\n/g, '\n').trim();
        if ((text !== '') && (RE_PRIVATE_KEY.test(text) === false)) {
            send_json(res, 400, {error: 'that is not a private key: it starts with -----BEGIN … PRIVATE KEY-----'});
            return;
        }
        target.key = (text === '') ? null : `${text}\n`;
        send_json(res, 200, key_said(target.key));
        return;
    }
    const remote = address.searchParams.get('remote');
    if ((address.pathname === '/create') && (req.method === 'POST')) {
        send_json(res, 200, await terminal_make(url, remote, address.searchParams.get('name'), target.key));
        return;
    }
    if ((address.pathname === '/terminals') && (req.method === 'GET')) {
        send_json(res, 200, await terminals_list({url, token: process.env.SERVICEMAN_TOKEN, remote}));
        return;
    }
    if ((address.pathname === '/end') && (req.method === 'POST')) {
        const name = address.searchParams.get('name');
        const answer = await fetch(new URL(`/api/v1/remotes/${encodeURIComponent(remote)}/terminals/${encodeURIComponent(name)}/end`, url), {method: 'POST', headers: token_headers({})});
        send_json(res, answer.status, (answer.status === 401) ? {error: token_wanted()} : await answer.json());
        return;
    }
    send_json(res, 404, {error: `no such page: ${address.pathname}`});
}

// WS /term?remote=&name=
// The page's socket joined to the terminal: its bytes go out as they come, and what the page
// sends — {type: 'input'} and {type: 'resize'} — goes to the terminal
function join(url, client, req)
{
    const address = new URL(req.url, 'http://x');
    const terminal = terminal_connect({url, token: process.env.SERVICEMAN_TOKEN, remote: address.searchParams.get('remote'), name: address.searchParams.get('name')});
    terminal.on('data', v => client.send(v));
    terminal.on('note', v => client.send(JSON.stringify({type: 'note', text: v})));
    terminal.on('close', () => client.close());
    terminal.on('error', function (error) {
        client.send(JSON.stringify({type: 'note', text: unreachable(url, error)}));
        client.close();
    });
    // What the page says before serviceman has answered waits for it: the page's size above all
    const waiting = [];
    let open = false;
    terminal.on('open', function () {
        open = true;
        for (const message of waiting.splice(0)) {
            pass(message);
        }
    });
    client.on('message', function (raw) {
        const message = JSON.parse(String(raw));
        if (open) {
            pass(message);
            return;
        }
        waiting.push(message);
    });
    client.on('close', () => terminal.close());

    function pass(message) {
        if (message.type === 'input') {
            terminal.write(message.data);
        }
        if (message.type === 'resize') {
            terminal.resize(message.cols, message.rows);
        }
    }
}

// A terminal made on the machine, and when a key is kept, set up before anyone joins: an
// ssh-agent of the terminal's own, then the key typed into it with the terminal's echo off, so it
// is never on the screen, in the history a later page is shown, or in a file. `head -c` takes
// exactly the key's bytes, whatever mode the terminal is in. The host keys of GitHub and
// Bitbucket go to known_hosts when they are not there yet.
async function terminal_make(url, remote, name, key)
{
    const made = await fetch(new URL(`/api/v1/remotes/${encodeURIComponent(remote)}/terminals`, url), {method: 'POST', headers: token_headers({}), body: JSON.stringify({name})});
    const record = await made.json();
    if (made.ok === false) {
        throw Object.assign(new Error(record.error), {status: made.status});
    }
    if (key === null) {
        return Object.assign(record, {key: false});
    }
    const terminal = terminal_connect({url, token: process.env.SERVICEMAN_TOKEN, remote, name: record.name});
    let screen = '';
    terminal.on('data', v => screen += v.toString('utf8'));
    await new Promise(function (resolve, reject) {
        terminal.on('open', resolve);
        terminal.on('error', reject);
    });
    try {
        // A space first keeps the line out of the shell's history. KEY''-READY is printed as
        // KEY-READY only once the echo is off, never by the echo of the line itself.
        terminal.write([
            ` eval $(ssh-agent -s) >/dev/null`,
            `trap 'ssh-agent -k >/dev/null' EXIT HUP TERM`,
            'stty -echo',
            `echo KEY''-READY`,
            `head -c ${Buffer.byteLength(key)} | ssh-add -q -t ${KEY_HOURS}h -`,
            'stty echo',
            `mkdir -p -m 700 ~/.ssh`,
            ...HOST_KEYS.map(v => `grep -qs '^${v.split(' ')[0]} ssh-ed25519 ' ~/.ssh/known_hosts || echo '${v}' >> ~/.ssh/known_hosts`),
            'clear',
            'ssh-add -l\r',
        ].join('; '));
        await until(() => screen.includes('KEY-READY'));
        terminal.write(key);
        // The terminal is ready once it says which key its agent holds
        await until(() => /SHA256:|no identities|Error/.test(screen.slice(screen.indexOf('KEY-READY'))));
    }
    finally {
        terminal.close();
    }
    return Object.assign(record, {key: true});
}

// One request to serviceman as the page sent it, and its answer back as it comes: a file
// streams, and a watch stays open until the page closes it
function pass_through(url, req, res)
{
    return new Promise(function (resolve, reject) {
        const headers = {};
        for (const name of FS_HEADERS) {
            if (req.headers[name] !== undefined) {
                headers[name] = req.headers[name];
            }
        }
        const there = new URL(req.url, url);
        const upstream = http.request(there, {method: req.method, headers: token_headers(headers)}, function (answer) {
            if (answer.statusCode === 401) {
                answer.resume();
                send_json(res, 401, {error: token_wanted()});
                resolve();
                return;
            }
            res.writeHead(answer.statusCode, answer.headers);
            answer.pipe(res);
            answer.on('end', resolve);
            answer.on('error', resolve);
        });
        upstream.on('error', function (error) {
            if (res.headersSent === false) {
                reject(error);
                return;
            }
            // Cut off half way: the page sees its stream end
            res.destroy();
            resolve();
        });
        // The page went away: a watch or a download it held ends at serviceman too
        res.on('close', function () {
            upstream.destroy();
            resolve();
        });
        req.pipe(upstream);
    });
}

async function until(ok)
{
    const deadline = Date.now() + 10000;
    while (ok() === false) {
        if (Date.now() > deadline) {
            throw new Error('the machine did not answer in time');
        }
        await new Promise(v => setTimeout(v, 100));
    }
}

// What the page is told of a key: never the key
function key_said(key)
{
    if (key === null) {
        return {set: false, kind: null};
    }
    const kind = /^-----BEGIN ([A-Z ]*)PRIVATE KEY-----/.exec(key)[1].trim();
    return {set: true, kind: (kind === '') ? 'PKCS#8' : kind};
}

function body_read(req)
{
    return new Promise(function (resolve, reject) {
        const chunks = [];
        req.on('data', v => chunks.push(v));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

// What fetch says when nothing answers is "fetch failed"; the reason is in its cause. A 401,
// or a shell socket closed at once with no token given, is the token serviceman wants.
function unreachable(url, error)
{
    if ((error.status === 401) || ((error.code === 'ECONNRESET') && (token_given() === false))) {
        return token_wanted();
    }
    const reason = (error.cause === undefined) ? error.message : (error.cause.code || error.cause.message);
    if ((reason === 'ECONNREFUSED') || (reason === 'ENOTFOUND') || (error.message === 'fetch failed')) {
        return `serviceman does not answer at ${url} (${reason}): start it, or set URL to its control page`;
    }
    return error.message;
}

// Whether SERVICEMAN_TOKEN is set
function token_given()
{
    return (process.env.SERVICEMAN_TOKEN !== undefined) && (process.env.SERVICEMAN_TOKEN !== '');
}

// The headers of a request to serviceman, with SERVICEMAN_TOKEN when it is set
function token_headers(headers)
{
    if (token_given() === false) {
        return headers;
    }
    return Object.assign({}, headers, {authorization: `Bearer ${process.env.SERVICEMAN_TOKEN}`});
}

// What a 401 from serviceman means: no token given, or one it does not know
function token_wanted()
{
    if (token_given()) {
        return 'serviceman does not know the token in SERVICEMAN_TOKEN: bin/owner-token prints the owner\'s';
    }
    return 'serviceman wants a token: SERVICEMAN_TOKEN=… (bin/owner-token prints the owner\'s)';
}

function send_json(res, status, body)
{
    res.writeHead(status, {'content-type': 'application/json'});
    res.end(JSON.stringify(body));
}
