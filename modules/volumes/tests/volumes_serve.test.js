const assert = require('assert');
const http = require('http');
const test = require('node:test');
const volumes_serve = require('../server/volumes_serve');

const KEY = 'k3y-0f-the-client-32-bytes-long!';
const VOLUME = {name: 'projects', owner: 'user', target: '/home/user/projects', state: 'open', size: 20*1024**3, on_disk: 1024**3, used: 512*1024**2, free: 19*1024**3};

// The module mounted at /volumes of a server of its own, over a machine that answers `answer`
async function serve(answer, key_safe)
{
    const asked = [];
    const logged = [];
    const server = http.createServer(function (req, res) {
        volumes_serve(req, res, {
            call: async function (params) {
                asked.push(params);
                return answer(params);
            },
            key_safe,
            tail: req.url.slice('/volumes'.length),
            log: function (event, fields) {
                logged.push([event, fields]);
            },
        });
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    return {
        asked,
        logged,
        base: `http://127.0.0.1:${server.address().port}/volumes`,
        close: function () {
            server.close();
        },
    };
}

async function fetch_json(url, method, body)
{
    const answer = await fetch(url, {method, body: ((body === undefined) ? undefined : JSON.stringify(body))});
    return {status: answer.status, body: await answer.json()};
}

test('the list is asked as a look, and answered without the machine\'s ok', async function () {
    const host = await serve(() => ({ok: true, items: [VOLUME], disk_free: 400*1024**3}), true);
    try {
        const answer = await fetch_json(host.base, 'GET');
        assert.deepStrictEqual(answer, {status: 200, body: {items: [VOLUME], disk_free: 400*1024**3}});
        assert.deepStrictEqual(host.asked, [{action: 'list', look: true}]);
        assert.deepStrictEqual(host.logged, [], 'a look is not logged');
    }
    finally {
        host.close();
    }
});

test('create, open, grow and delete pass on only the fields they take, and log the volume without its key', async function () {
    const host = await serve(() => Object.assign({ok: true, already: false}, VOLUME), true);
    try {
        await fetch_json(host.base, 'POST', {name: 'projects', owner: 'user', target: '/home/user/projects', size: '20G', key: KEY, passphrase: true, plain_remove: true, action: 'close', extra: 1});
        await fetch_json(`${host.base}/projects/open`, 'POST', {key: KEY, name: 'other'});
        await fetch_json(`${host.base}/projects/grow`, 'POST', {size: '40G'});
        await fetch_json(`${host.base}/projects/delete`, 'POST', {name: 'other'});
        assert.deepStrictEqual(host.asked, [
            {name: 'projects', owner: 'user', target: '/home/user/projects', size: '20G', key: KEY, passphrase: true, plain_remove: true, action: 'create'},
            {key: KEY, action: 'open', name: 'projects'},
            {size: '40G', action: 'grow', name: 'projects'},
            {action: 'delete', name: 'projects'},
        ]);
        assert.deepStrictEqual(host.logged.map(v => v[0]), ['volume_created', 'volume_opened', 'volume_grown', 'volume_deleted']);
        assert.ok(host.logged.every(v => JSON.stringify(v).includes(KEY) === false));
    }
    finally {
        host.close();
    }
});

test('a key over a link it may not travel on is refused before the machine is asked', async function () {
    const host = await serve(() => ({ok: true}), false);
    try {
        const opened = await fetch_json(`${host.base}/projects/open`, 'POST', {key: KEY});
        assert.deepStrictEqual(opened, {status: 403, body: {code: 'key_not_safe', error: 'a key is taken only over https or from this machine'}});
        const created = await fetch_json(host.base, 'POST', Object.assign({}, VOLUME, {key: KEY}));
        assert.strictEqual(created.status, 403);
        assert.deepStrictEqual(host.asked, []);
    }
    finally {
        host.close();
    }
});

test('the machine\'s refusals keep their status and what they carry; an unknown door is a 404', async function () {
    const users = [{pid: 4242, how: 'cwd', user: 'user', command: 'bash'}];
    const host = await serve(() => ({ok: false, status: 409, error: '"projects" is in use', users}), true);
    try {
        const answer = await fetch_json(`${host.base}/projects/close`, 'POST');
        assert.deepStrictEqual(answer, {status: 409, body: {error: '"projects" is in use', users}});
        assert.deepStrictEqual(host.logged, [], 'nothing done, nothing logged');
        assert.strictEqual((await fetch_json(`${host.base}/projects/shrink`, 'POST')).status, 404);
        assert.strictEqual((await fetch_json(`${host.base}/../etc/open`, 'POST')).status, 404);
    }
    finally {
        host.close();
    }
});

test('a machine that cannot be asked is a 502 that says why', async function () {
    const host = await serve(() => Promise.reject(new Error('remote phone is offline — its agent is not dialled in')), true);
    try {
        const answer = await fetch_json(host.base, 'GET');
        assert.deepStrictEqual(answer, {status: 502, body: {error: 'remote phone is offline — its agent is not dialled in'}});
    }
    finally {
        host.close();
    }
});
