const fs = require('fs');
const http = require('http');

// A docker engine for the tests, on a socket of its own: containers that write lines when told
// to, and the few parts of the API the agent reads — the list, one container, its logs, and the
// events as containers start. Its stamps are docker's shape, trailing zeros dropped, and its
// `since` takes the stamp itself too, the way docker's does.
async function fake_docker_engine(socket)
{
    const engine = {containers: new Map(), followers: new Set(), watchers: new Set(), clock: 0n, base: BigInt(Date.parse('2026-09-25T18:00:00Z'))*1000000n};
    const server = http.createServer(function (req, res) {
        route(engine, req, res);
    });
    fs.rmSync(socket, {force: true});
    await new Promise(v => server.listen(socket, v));
    return {
        // A container, running unless said otherwise: its id
        add: function (name, options) {
            const id = `${name}${'0'.repeat(64)}`.slice(0, 64);
            const opts = options || {};
            engine.containers.set(id, {id, name, image: opts.image || 'demo/image', labels: opts.labels || {}, tty: opts.tty === true, running: opts.running !== false, logs: []});
            if (opts.running !== false) {
                event_say(engine, id);
            }
            return id;
        },
        // One line, stamped now, to whoever follows the container
        log: function (id, text, stream) {
            const at = stamp_next(engine);
            const item = {at, at_text: stamp_text(at), stream: ((stream === 'stderr') ? 2 : 1), text};
            const container = engine.containers.get(id);
            container.logs.push(item);
            for (const follower of engine.followers) {
                if ((follower.id === id) && (item.at >= follower.since)) {
                    follower.res.write(frame_of(container, item));
                }
            }
            return item.at_text;
        },
        start: function (id) {
            engine.containers.get(id).running = true;
            event_say(engine, id);
        },
        stop: function (id) {
            engine.containers.get(id).running = false;
            for (const follower of [...engine.followers]) {
                if (follower.id === id) {
                    engine.followers.delete(follower);
                    follower.res.end();
                }
            }
        },
        remove: function (id) {
            this.stop(id);
            engine.containers.delete(id);
        },
        // The moment the next line will carry, as the agent would write a floor
        now: () => stamp_text(engine.base + engine.clock + 1n),
        close: function () {
            for (const item of [...engine.followers, ...engine.watchers]) {
                item.res.destroy();
            }
            server.closeAllConnections();
            server.close();
        },
    };
}

function route(engine, req, res)
{
    const url = new URL(req.url, 'http://docker');
    const one = /^\/containers\/([^/]+)\/json$/.exec(url.pathname);
    const logs = /^\/containers\/([^/]+)\/logs$/.exec(url.pathname);
    if (url.pathname === '/containers/json') {
        json_send(res, 200, [...engine.containers.values()].map(v => ({Id: v.id})));
        return;
    }
    if (one !== null) {
        const found = engine.containers.get(one[1]);
        if (found === undefined) {
            json_send(res, 404, {message: `No such container: ${one[1]}`});
            return;
        }
        json_send(res, 200, {Id: found.id, Name: `/${found.name}`, Config: {Image: found.image, Labels: found.labels, Tty: found.tty}, State: {Running: found.running}});
        return;
    }
    if (logs !== null) {
        const found = engine.containers.get(logs[1]);
        if (found === undefined) {
            json_send(res, 404, {message: `No such container: ${logs[1]}`});
            return;
        }
        const since = since_of(url.searchParams.get('since'));
        res.writeHead(200, {'content-type': 'application/vnd.docker.multiplexed-stream'});
        for (const item of found.logs) {
            if (item.at >= since) {
                res.write(frame_of(found, item));
            }
        }
        if ((url.searchParams.get('follow') === '1') && found.running) {
            const follower = {id: found.id, since, res};
            engine.followers.add(follower);
            res.on('close', () => engine.followers.delete(follower));
            return;
        }
        res.end();
        return;
    }
    if (url.pathname === '/events') {
        res.writeHead(200, {'content-type': 'application/json'});
        const watcher = {res};
        engine.watchers.add(watcher);
        res.on('close', () => engine.watchers.delete(watcher));
        return;
    }
    json_send(res, 404, {message: 'page not found'});
}

function event_say(engine, id)
{
    for (const watcher of engine.watchers) {
        watcher.res.write(`${JSON.stringify({Type: 'container', Action: 'start', status: 'start', id})}\n`);
    }
}

// A frame of docker's stream — which stream, how long, then the stamped line — or just the line
// for a container with a terminal
function frame_of(container, item)
{
    const text = Buffer.from(`${item.at_text} ${item.text}\n`);
    if (container.tty) {
        return text;
    }
    const head = Buffer.alloc(8);
    head[0] = item.stream;
    head.writeUInt32BE(text.length, 4);
    return Buffer.concat([head, text]);
}

// Nanoseconds since the epoch, as a BigInt, and docker's text for it beside
function stamp_next(engine)
{
    engine.clock += 1000n + BigInt(Math.floor(Math.random()*5000));
    return engine.base + engine.clock;
}

function stamp_text(ns)
{
    const ms = Number(ns/1000000n);
    const fraction = String(ns % 1000000000n).padStart(9, '0').replace(/0+$/, '');
    return `${new Date(ms).toISOString().slice(0, 19)}${(fraction === '') ? '' : `.${fraction}`}Z`;
}

function since_of(text)
{
    if (text === null) {
        return 0n;
    }
    const [secs, nanos] = text.split('.');
    return BigInt(secs)*1000000000n + BigInt((nanos || '0').padEnd(9, '0').slice(0, 9));
}

function json_send(res, status, value)
{
    res.writeHead(status, {'content-type': 'application/json'});
    res.end(JSON.stringify(value));
}

module.exports = fake_docker_engine;
