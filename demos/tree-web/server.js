const cli = require('@vbarbarosh/node-helpers/src/cli');
const fs = require('fs');
const http = require('http');
const path = require('path');

// The page and the files API client it calls through, served from this checkout
const FILES = {
    '/': {file: path.join(__dirname, 'index.html'), type: 'text/html; charset=utf-8'},
    '/fs_client.mjs': {file: path.join(__dirname, '..', 'files-web', 'fs_client.mjs'), type: 'text/javascript'},
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

// A whole tree of a machine's folder in one request, for a developer to see the call a program
// copying a folder makes first: what is already there. The page lists it as one JSON or as
// events, with hashes and names to skip, and shows each request and its answer. The calls are
// tree and tree_events in files-web/fs_client.mjs; this server only passes them to serviceman.
//
//     node demos/tree-web/server.js
//
// Nothing has to be set: it finds serviceman, opens on its first machine, and says at start
// what it settled on. PORT, URL and ?remote=<machine> choose otherwise.
cli(main);

async function main()
{
    const port = parseInt(process.env.PORT || '8093', 10);
    const target = await serviceman_find();
    const server = http.createServer(function (req, res) {
        handle(target, req, res).catch(function (error) {
            send_json(res, 502, {error: unreachable(target.url, error)});
        });
    });
    await new Promise(v => server.listen(port, '127.0.0.1', v));
    console.log('tree-web');
    console.log(`    page        http://127.0.0.1:${port}/    (${(process.env.PORT === undefined) ? 'PORT, 8093 by default' : 'PORT'})`);
    console.log(`    serviceman  ${target.url}    (${target.how})`);
    console.log(`    machine     ${(target.remote === null) ? 'none listed yet' : target.remote}    (${(target.remotes.length > 1) ? `the first of ${target.remotes.join(', ')}; ` : ''}?remote=<name> opens another)`);
    if (target.answered === false) {
        console.log('    nothing answers there yet: the page waits for serviceman to start');
    }
    await new Promise(v => server.on('close', v));
}

// URL when it is set; otherwise the first place serviceman answers
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

// Whether serviceman answers there, and the machines it knows
async function serviceman_ask(url)
{
    try {
        const answer = await fetch(new URL('/api/v1/status', url), {signal: AbortSignal.timeout(2000)});
        const body = await answer.json();
        const remotes = (Array.isArray(body.remotes) ? body.remotes.map(v => v.name) : []);
        return {answered: Array.isArray(body.remotes), remotes, remote: ((remotes.length === 0) ? null : remotes[0])};
    }
    catch {
        return {answered: false, remotes: [], remote: null};
    }
}

// GET  /                          the page
// GET  /defaults                  the machines serviceman knows, and the one the page opens on
// *    /api/v1/remotes/<name>/fs…  serviceman's files API, passed through
async function handle(target, req, res)
{
    const address = new URL(req.url, 'http://x');
    // The machines are asked again each time the page opens, so one added since shows
    if ((target.answered === false) || (address.pathname === '/defaults')) {
        Object.assign(target, await serviceman_find());
    }
    if (RE_FS.test(address.pathname)) {
        await pass_through(target.url, req, res);
        return;
    }
    const found = FILES[address.pathname];
    if ((found !== undefined) && (req.method === 'GET')) {
        res.writeHead(200, {'content-type': found.type});
        fs.createReadStream(found.file).pipe(res);
        return;
    }
    if ((address.pathname === '/defaults') && (req.method === 'GET')) {
        send_json(res, 200, {answered: target.answered, url: target.url, remotes: target.remotes, remote: target.remote});
        return;
    }
    send_json(res, 404, {error: `no such page: ${address.pathname}`});
}

// One request to serviceman as the page sent it, and its answer back as it comes: events
// stream, and a page that goes away stops the walk at serviceman too
function pass_through(url, req, res)
{
    return new Promise(function (resolve, reject) {
        const headers = {};
        for (const name of FS_HEADERS) {
            if (req.headers[name] !== undefined) {
                headers[name] = req.headers[name];
            }
        }
        const upstream = http.request(new URL(req.url, url), {method: req.method, headers}, function (answer) {
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
            res.destroy();
            resolve();
        });
        res.on('close', function () {
            upstream.destroy();
            resolve();
        });
        req.pipe(upstream);
    });
}

// What fetch says when nothing answers is "fetch failed"; the reason is in its cause
function unreachable(url, error)
{
    const reason = ((error.cause === undefined) ? error.message : (error.cause.code || error.cause.message));
    if ((reason === 'ECONNREFUSED') || (reason === 'ENOTFOUND') || (error.message === 'fetch failed')) {
        return `serviceman does not answer at ${url} (${reason}): start it, or set URL to its control page`;
    }
    return error.message;
}

function send_json(res, status, body)
{
    res.writeHead(status, {'content-type': 'application/json'});
    res.end(JSON.stringify(body));
}
