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
};

// Where serviceman's control page is looked for when URL does not say: as bin/run publishes
// it, then the default of its config
const SERVICEMAN_PLACES = [
    {url: 'http://127.0.0.1:3001', how: 'found: serviceman from bin/run'},
    {url: 'http://127.0.0.1:8081', how: 'found: serviceman on its config default'},
];

// A whole terminal in a web page of its own, for the terminals serviceman keeps on a machine:
// this server holds the connection to serviceman and the page talks to it alone, so the page
// may live anywhere this server answers.
//
//     node demos/terminal-web/server.js
//
// Nothing has to be set: it finds serviceman, opens on its first machine, and says at start
// what it settled on. PORT, URL and ?remote=<machine> choose otherwise. SERVICEMAN_TOKEN is
// the token serviceman wants, which bin/owner-token prints; this server sends it on every
// request there, and never the page's own cookie.
cli(main);

async function main()
{
    const port = parseInt(process.env.PORT || '8090', 10);
    const target = await serviceman_find();
    const server = http.createServer(function (req, res) {
        handle(target, req, res).catch(function (error) {
            send_json(res, 502, {error: unreachable(target.url, error)});
        });
    });
    const sockets = new ws.WebSocketServer({server, path: '/term'});
    sockets.on('connection', (client, req) => join(target.url, client, req));
    await new Promise(v => server.listen(port, '127.0.0.1', v));
    console.log('terminal-web');
    console.log(`    page        http://127.0.0.1:${port}/    (${(process.env.PORT === undefined) ? 'PORT, 8090 by default' : 'PORT'})`);
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
async function handle(target, req, res)
{
    if ((target.answered === false) || target.refused) {
        Object.assign(target, await serviceman_find());
    }
    const url = target.url;
    const address = new URL(req.url, 'http://x');
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
    const remote = address.searchParams.get('remote');
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
