const assert = require('assert');
const docker_serve = require('../server/docker_serve');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('the containers grouped by their labels; a container started, stopped, restarted; a project updated step by step', async function (t) {
    const engine = await engine_start(t);
    const ran = [];
    let fail_at = null;
    const running = await serve(t, {
        connect: () => net.connect(engine.socket),
        run: async function (argv) {
            ran.push(argv.join(' '));
            if ((fail_at !== null) && argv.join(' ').endsWith(fail_at)) {
                return {ok: false, code: 1, stdout: '', stderr: 'no such image\n'};
            }
            return {ok: true, code: 0, stdout: `ran ${argv[argv.length - 1]}\n`, stderr: ''};
        },
        own: v => v.startsWith('serviceman-'),
    });

    // Every container, with what the page needs; serviceman's own marked
    const listed = JSON.parse((await call(running, 'GET', '/docker/containers')).body).items;
    assert.deepStrictEqual(listed.map(v => [v.name, v.project, v.service, v.state, v.own]), [
        ['shop-web-1', 'shop', 'web', 'running', false],
        ['shop-db-1', 'shop', 'db', 'exited', false],
        ['serviceman-echo', null, null, 'running', true],
    ]);
    assert.deepStrictEqual(listed[0].ports, ['8080→80/tcp']);
    assert.strictEqual(listed[0].dir, '/srv/shop');

    // A container's action is the engine's; one already in that state is fine as it is
    assert.strictEqual((await call(running, 'POST', `/docker/containers/${'a'.repeat(64)}/stop`)).status, 200);
    assert.strictEqual((await call(running, 'POST', `/docker/containers/${'b'.repeat(64)}/start`)).status, 200);
    assert.deepStrictEqual(engine.asked, [`POST /containers/${'a'.repeat(64)}/stop`, `POST /containers/${'b'.repeat(64)}/start`]);
    const refused = await call(running, 'POST', `/docker/containers/${'c'.repeat(64)}/restart`);
    assert.deepStrictEqual([refused.status, JSON.parse(refused.body).error], [502, 'docker answered 404: No such container']);
    assert.strictEqual((await call(running, 'POST', '/docker/containers/../stop')).status, 404);
    // A stopped container is removed by the engine's DELETE; its image and volumes stay
    assert.strictEqual((await call(running, 'POST', `/docker/containers/${'b'.repeat(64)}/remove`)).status, 200);
    assert.strictEqual(engine.asked[engine.asked.length - 1], `DELETE /containers/${'b'.repeat(64)}`);

    // A project: its folder and files from its labels, the steps in order, the text as it goes
    const update = await call(running, 'POST', '/docker/projects/shop/update');
    assert.strictEqual(update.status, 200);
    assert.deepStrictEqual(said(update.body), [
        {step: 1, steps: 2, name: 'pull', text: '$ docker compose -p shop -f /srv/shop/compose.yml -f /srv/shop/compose.prod.yml pull'},
        {text: 'ran pull'},
        {step: 2, steps: 2, name: 'up -d', text: '$ docker compose -p shop -f /srv/shop/compose.yml -f /srv/shop/compose.prod.yml up -d'},
        {text: 'ran -d'},
        {end: 'done', said: 'shop: pull, then up -d'},
    ]);
    ran.length = 0;
    await call(running, 'POST', '/docker/projects/shop/recreate');
    assert.deepStrictEqual(ran.map(v => v.split(' ').slice(-2).join(' ')), ['/srv/shop/compose.prod.yml pull', '/srv/shop/compose.prod.yml down', 'up -d']);

    // A step that fails ends it there, and says so
    ran.length = 0;
    fail_at = 'pull';
    const failed = said((await call(running, 'POST', '/docker/projects/shop/recreate')).body);
    assert.deepStrictEqual(failed.slice(-2), [{text: 'no such image'}, {end: 'failed', said: 'pull failed with code 1'}]);
    assert.strictEqual(ran.length, 1);

    // A project no container names is not run at all
    assert.strictEqual((await call(running, 'POST', '/docker/projects/nowhere/update')).status, 404);
});

test('images, volumes and networks with the containers that use each; removed, pruned, an image pulled again', async function (t) {
    const engine = await engine_start(t);
    const running = await serve(t, {connect: () => net.connect(engine.socket), run: async () => ({ok: true})});

    const images = JSON.parse((await call(running, 'GET', '/docker/images')).body).items;
    assert.deepStrictEqual(images.map(v => [v.tags.join(','), v.used_by.join(','), v.dangling, v.read_only]), [
        ['shop/web:latest', 'shop-web-1', false, false],
        ['', '', true, false],
        ['old/thing:1', '', false, true],
    ]);
    const volumes = JSON.parse((await call(running, 'GET', '/docker/volumes')).body).items;
    assert.deepStrictEqual(volumes.map(v => [v.name, v.project, v.used_by.join(',')]), [['shop_data', 'shop', 'shop-web-1'], ['loose', null, '']]);
    // Where a volume's files are: on the machine, and in each container that mounts it
    assert.strictEqual(volumes[0].mountpoint, '/var/lib/docker/volumes/shop_data/_data');
    assert.deepStrictEqual(volumes[0].mounts, [{id: 'a'.repeat(64), name: 'shop-web-1', running: true, destination: '/data'}]);
    assert.deepStrictEqual([volumes[1].mountpoint, volumes[1].mounts], [null, []]);
    const networks = JSON.parse((await call(running, 'GET', '/docker/networks')).body).items;
    assert.deepStrictEqual(networks.map(v => [v.name, v.subnet, v.project, v.used_by.join(','), v.builtin]), [['bridge', '10.88.0.0/16', null, '', true], ['shop_default', '10.89.0.0/24', 'shop', 'shop-web-1,shop-db-1', false]]);

    // A removal is the engine's; one it refuses because something uses it says so as 409
    assert.strictEqual((await call(running, 'POST', `/docker/images/${'2'.repeat(64)}/remove`)).status, 200);
    assert.strictEqual((await call(running, 'POST', '/docker/volumes/loose/remove')).status, 200);
    const busy = await call(running, 'POST', `/docker/networks/${'6'.repeat(64)}/remove`);
    assert.deepStrictEqual([busy.status, JSON.parse(busy.body).error], [409, 'docker answered 409: network is in use']);
    assert.deepStrictEqual(engine.asked.filter(v => v.startsWith('DELETE')), [`DELETE /images/${'2'.repeat(64)}`, 'DELETE /volumes/loose', `DELETE /networks/${'6'.repeat(64)}`]);

    // A prune takes one thing at a time and says how far it is: images with no container (one
    // podman may only read stays), the dangling ones only without all=1; volumes nothing mounts
    engine.asked.length = 0;
    const pruned = said((await call(running, 'POST', '/docker/images/prune?all=1')).body);
    assert.deepStrictEqual(pruned, [
        {progress: {done: 0, total: 1, bytes: 0, total_bytes: 1024, unit: 'items'}},
        {text: `removed ${'2'.repeat(12)} (1.0KB)`},
        {progress: {done: 1, total: 1, bytes: 1024, total_bytes: 1024, unit: 'items'}},
        {end: 'done', said: 'removed 1 of 1, up to 1.0KB freed'},
    ]);
    assert.deepStrictEqual(engine.asked, [`DELETE /images/${'2'.repeat(64)}`]);
    const dangling = said((await call(running, 'POST', '/docker/images/prune')).body);
    assert.strictEqual(dangling[dangling.length - 1].said, 'removed 1 of 1, up to 1.0KB freed');
    const volumes_pruned = said((await call(running, 'POST', '/docker/volumes/prune')).body);
    assert.deepStrictEqual(volumes_pruned.filter(v => v.text !== undefined), [{text: 'removed loose'}]);
    // Nothing left to take: said as that, with no progress at all
    const nothing = said((await call(running, 'POST', '/docker/networks/prune')).body);
    assert.deepStrictEqual(nothing, [{end: 'done', said: 'nothing to remove: every network has a container on it, or is built in'}]);

    // A pull again under the image's first name: a line when a layer says something new
    // A pull again under the image's first name: a line when a layer says something new, and its
    // layers' bytes added up into one number
    const pulled = said((await call(running, 'POST', `/docker/images/${'1'.repeat(64)}/pull`)).body);
    assert.deepStrictEqual(pulled.filter(v => v.text !== undefined).map(v => v.text), ['$ docker pull shop/web:latest', 'Pulling from shop/web', 'abc: Pulling fs layer', 'abc: Downloading', 'abc: Pull complete']);
    assert.deepStrictEqual(pulled.filter(v => v.progress !== undefined).pop(), {progress: {done: 400, total: 400, unit: 'bytes'}});
    assert.deepStrictEqual(pulled[pulled.length - 1], {end: 'done', said: 'shop/web:latest is the newest there is'});
    assert.ok(engine.asked.includes('POST /images/create?fromImage=shop%2Fweb&tag=latest'));
    assert.strictEqual((await call(running, 'POST', `/docker/images/${'2'.repeat(64)}/pull`)).status, 404);
});

test('a volume nothing mounts opens through a helper container, which no list shows and close removes', async function (t) {
    const engine = await engine_start(t);
    const running = await serve(t, {connect: () => net.connect(engine.socket), run: async () => ({ok: true})});

    // The first open pulls busybox and starts a helper that mounts the volume; the next finds it
    const opened = JSON.parse((await call(running, 'POST', '/docker/volumes/loose/open')).body);
    assert.deepStrictEqual(opened, {id: 'f'.repeat(64), path: '/volume'});
    assert.ok(engine.asked.includes('POST /images/create?fromImage=docker.io%2Flibrary%2Fbusybox&tag=latest'));
    assert.deepStrictEqual(engine.created[0], {
        Image: 'docker.io/library/busybox:latest',
        Cmd: ['sleep', '3600'],
        Labels: {'docker-module.helper': 'volume', 'docker-module.volume': 'loose'},
        HostConfig: {Binds: ['loose:/volume'], AutoRemove: true},
    });
    assert.deepStrictEqual(JSON.parse((await call(running, 'POST', '/docker/volumes/loose/open')).body), opened);
    assert.strictEqual(engine.created.length, 1);

    // It is in no list, and mounts nothing as far as "used by" goes
    const containers = JSON.parse((await call(running, 'GET', '/docker/containers')).body).items;
    assert.strictEqual(containers.some(v => v.id === 'f'.repeat(64)), false);
    const volumes = JSON.parse((await call(running, 'GET', '/docker/volumes')).body).items;
    assert.deepStrictEqual(volumes.find(v => v.name === 'loose').used_by, []);

    // Close kills it, then removes it
    assert.strictEqual((await call(running, 'POST', '/docker/volumes/loose/close')).status, 200);
    assert.deepStrictEqual(engine.asked.slice(-2), [`POST /containers/${'f'.repeat(64)}/kill`, `DELETE /containers/${'f'.repeat(64)}?force=1`]);
});

test('an engine that cannot be reached is a 502 with the reason', async function (t) {
    const running = await serve(t, {connect: () => net.connect(path.join(os.tmpdir(), 'no-such-docker.sock')), run: async () => ({ok: true})});
    const answer = await call(running, 'GET', '/docker/containers');
    assert.strictEqual(answer.status, 502);
    assert.match(JSON.parse(answer.body).error, /ENOENT/);
});

// The part of the Engine API the module asks for, on a socket file of its own
async function engine_start(t)
{
    const socket = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'docker-engine-')), 'docker.sock');
    const out = {socket, asked: []};
    const shop = {
        'com.docker.compose.project': 'shop',
        'com.docker.compose.project.working_dir': '/srv/shop',
        // docker compose names the files in full; podman-compose names them from the folder
        'com.docker.compose.project.config_files': '/srv/shop/compose.yml,compose.prod.yml',
    };
    const containers = [
        {Id: 'a'.repeat(64), Names: ['/shop-web-1'], Image: 'shop/web:latest', State: 'running', Status: 'Up 2 hours', Created: 1759400000, Ports: [{PrivatePort: 80, PublicPort: 8080, Type: 'tcp', IP: '0.0.0.0'}, {PrivatePort: 80, PublicPort: 8080, Type: 'tcp', IP: '::'}], Labels: Object.assign({'com.docker.compose.service': 'web'}, shop)},
        {Id: 'b'.repeat(64), Names: ['/shop-db-1'], Image: 'postgres:17', State: 'exited', Status: 'Exited (0) 3 days ago', Created: 1759300000, Ports: [], Labels: Object.assign({'com.docker.compose.service': 'db'}, shop)},
        {Id: 'd'.repeat(64), Names: ['/serviceman-echo'], Image: 'echo', State: 'running', Status: 'Up 5 minutes', Created: 1759410000, Ports: [], Labels: {}},
        // An engine that lies: an id that is a path, under a friendly name, which no list shows
        {Id: '../../../../remotes/laptop/packages/upgrade?', Names: ['/friendly'], Image: 'echo', State: 'running', Status: 'Up 1 minute', Created: 1759410001, Ports: [], Labels: {}},
    ];
    containers[0].ImageID = `sha256:${'1'.repeat(64)}`;
    containers[0].Mounts = [{Type: 'volume', Name: 'shop_data', Destination: '/data'}];
    containers[0].NetworkSettings = {Networks: {shop_default: {}}};
    containers[1].NetworkSettings = {Networks: {shop_default: {}}};
    const stores = {
        '/images/json': [
            {Id: `sha256:${'1'.repeat(64)}`, RepoTags: ['shop/web:latest'], Size: 1000, Created: 1759400000},
            {Id: `sha256:${'2'.repeat(64)}`, RepoTags: ['<none>:<none>'], Size: 1024, Created: 1759300000},
            {Id: `sha256:${'3'.repeat(64)}`, RepoTags: ['old/thing:1'], Size: 1024, Created: 1759200000, ReadOnly: true},
        ],
        '/volumes': {Volumes: [
            {Name: 'shop_data', Driver: 'local', CreatedAt: '2025-10-02T10:00:00Z', Mountpoint: '/var/lib/docker/volumes/shop_data/_data', Labels: {'com.docker.compose.project': 'shop'}},
            {Name: 'loose', Driver: 'local', CreatedAt: '2025-10-02T10:00:00Z', Labels: null},
        ]},
        '/networks': [
            {Id: '5'.repeat(64), Name: 'bridge', Driver: 'bridge', IPAM: {Config: [{Subnet: '10.88.0.0/16'}]}, Labels: {}},
            {Id: '6'.repeat(64), Name: 'shop_default', Driver: 'bridge', IPAM: {Config: [{Subnet: '10.89.0.0/24'}]}, Labels: {'com.docker.compose.project': 'shop'}},
        ],
    };
    out.created = [];
    let busybox = false;
    const server = http.createServer(function (req, res) {
        // A helper container of the Docker module: made, started, found by its label, killed
        if ((req.method === 'GET') && req.url.startsWith('/images/docker.io%2Flibrary%2Fbusybox%3Alatest/json')) {
            res.writeHead(busybox ? 200 : 404, {'content-type': 'application/json'});
            res.end(busybox ? '{}' : JSON.stringify({message: 'no such image'}));
            return;
        }
        if ((req.method === 'POST') && (req.url === '/containers/create')) {
            const chunks = [];
            req.on('data', v => chunks.push(v));
            req.on('end', function () {
                const asked = JSON.parse(Buffer.concat(chunks));
                out.created.push(asked);
                containers.push({Id: 'f'.repeat(64), Names: ['/helper'], Image: asked.Image, State: 'created', Status: 'Created', Created: 1759420000, Ports: [], Labels: asked.Labels, Mounts: [{Type: 'volume', Name: 'loose', Destination: '/volume'}]});
                res.writeHead(201, {'content-type': 'application/json'});
                res.end(JSON.stringify({Id: 'f'.repeat(64)}));
            });
            return;
        }
        if ((req.method === 'POST') && (req.url === `/containers/${'f'.repeat(64)}/start`)) {
            containers[containers.length - 1].State = 'running';
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.url.startsWith('/containers/json?all=1&filters=')) {
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(JSON.stringify(containers.filter(v => v.Labels['docker-module.helper'] === 'volume')));
            return;
        }
        if (((req.method === 'POST') && (req.url === `/containers/${'f'.repeat(64)}/kill`)) || ((req.method === 'DELETE') && req.url.startsWith(`/containers/${'f'.repeat(64)}`))) {
            out.asked.push(`${req.method} ${req.url}`);
            res.writeHead(204);
            res.end();
            return;
        }
        if ((req.method === 'POST') && req.url.startsWith('/images/create?fromImage=docker.io')) {
            out.asked.push(`${req.method} ${req.url}`);
            busybox = true;
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(`${JSON.stringify({status: 'Pull complete'})}\n`);
            return;
        }
        if ((req.method === 'GET') && (req.url === '/containers/json?all=1')) {
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(JSON.stringify(containers));
            return;
        }
        if ((req.method === 'GET') && (stores[req.url] !== undefined)) {
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(JSON.stringify(stores[req.url]));
            return;
        }
        if (req.method === 'DELETE') {
            out.asked.push(`${req.method} ${req.url}`);
            if (req.url.startsWith('/networks/')) {
                res.writeHead(409, {'content-type': 'application/json'});
                res.end(JSON.stringify({message: 'network is in use'}));
                return;
            }
            res.writeHead(req.url.startsWith('/images/') ? 200 : 204, {'content-type': 'application/json'});
            res.end(req.url.startsWith('/images/') ? '[]' : '');
            return;
        }
        if ((req.method === 'POST') && /^\/(images|volumes|networks)\/prune/.test(req.url)) {
            out.asked.push(`${req.method} ${req.url}`);
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(JSON.stringify(req.url.startsWith('/images') ? {ImagesDeleted: [{}, {}], SpaceReclaimed: 2048} : {VolumesDeleted: ['loose'], SpaceReclaimed: 0}));
            return;
        }
        if ((req.method === 'POST') && req.url.startsWith('/images/create')) {
            out.asked.push(`${req.method} ${req.url}`);
            res.writeHead(200, {'content-type': 'application/json'});
            for (const item of [{status: 'Pulling from shop/web', id: undefined}, {status: 'Pulling fs layer', id: 'abc'}, {status: 'Downloading', id: 'abc', progressDetail: {current: 100, total: 400}}, {status: 'Downloading', id: 'abc', progressDetail: {current: 300, total: 400}}, {status: 'Pull complete', id: 'abc'}]) {
                res.write(`${JSON.stringify(item)}\n`);
            }
            res.end();
            return;
        }
        const found = /^\/containers\/([0-9a-f]+)\/(start|stop|restart)$/.exec(req.url);
        if ((req.method === 'POST') && (found !== null) && containers.some(v => v.Id === found[1])) {
            out.asked.push(`${req.method} ${req.url}`);
            res.writeHead((found[2] === 'start') ? 304 : 204);
            res.end();
            return;
        }
        res.writeHead(404, {'content-type': 'application/json'});
        res.end(JSON.stringify({message: 'No such container'}));
    });
    await new Promise(v => server.listen(socket, v));
    t.after(() => new Promise(v => server.close(v)));
    return out;
}

// The module mounted at /docker on a server of its own, the way a host mounts it
async function serve(t, options)
{
    const server = http.createServer(function (req, res) {
        const pathname = new URL(req.url, 'http://test.invalid').pathname;
        docker_serve(req, res, Object.assign({tail: pathname.slice('/docker'.length)}, options));
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(() => new Promise(v => server.close(v)));
    return {port: server.address().port};
}

function call(running, method, path_text, body)
{
    return new Promise(function (resolve, reject) {
        const request = http.request({host: '127.0.0.1', port: running.port, method, path: path_text}, function (answer) {
            const chunks = [];
            answer.on('data', v => chunks.push(v));
            answer.on('end', () => resolve({status: answer.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
        });
        request.on('error', reject);
        request.end(body);
    });
}

// A long action's answer, one JSON object a line
function said(body)
{
    return body.trim().split('\n').map(v => JSON.parse(v));
}

test('a host that keeps streams gets a long action\'s lines in one, and the answer is where it is', async function (t) {
    const engine = await engine_start(t);
    const streams = [];
    const running = await serve(t, {
        connect: () => net.connect(engine.socket),
        run: async v => ({ok: true, code: 0, stdout: `ran ${v[v.length - 1]}\n`, stderr: ''}),
        stream: function (title) {
            const out = {id: `s${streams.length + 1}`, url: `/streams/s${streams.length + 1}`, title, lines: [], ended: null};
            out.write = function (value) {
                out.lines.push(value);
            };
            out.end = function (value) {
                out.ended = value;
            };
            streams.push(out);
            return out;
        },
    });
    const update = await call(running, 'POST', '/docker/projects/shop/update');
    assert.deepStrictEqual([update.status, JSON.parse(update.body)], [202, {stream: 's1', url: '/streams/s1'}]);
    for (let i = 0; (i < 100) && (streams[0].ended === null); i++) {
        await new Promise(v => setTimeout(v, 10));
    }
    assert.strictEqual(streams[0].title, 'shop · update');
    assert.deepStrictEqual(streams[0].lines.map(v => v.text), ['$ docker compose -p shop -f /srv/shop/compose.yml -f /srv/shop/compose.prod.yml pull', 'ran pull', '$ docker compose -p shop -f /srv/shop/compose.yml -f /srv/shop/compose.prod.yml up -d', 'ran -d']);
    assert.deepStrictEqual(streams[0].ended, {end: 'done', said: 'shop: pull, then up -d'});

    // What is refused before it begins is still a plain answer, and no stream
    assert.strictEqual((await call(running, 'POST', '/docker/projects/nowhere/update')).status, 404);
    assert.strictEqual(streams.length, 1);
});
