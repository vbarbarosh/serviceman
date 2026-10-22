const assert = require('assert');
const disks_serve = require('../server/disks_serve');
const http = require('http');
const test = require('node:test');

const ANSWER = {at: 1761164000000, items: [{device: '/dev/sda1', type: 'ext4', mounts: ['/'], disk: true, total: 100*1024**3, used: 40*1024**3, free: 60*1024**3, inodes_total: 6553600, inodes_used: 400000, inodes_free: 6153600, encrypted: false, key_of: null}], commands: ['df -PkT', 'df -PiT']};

// The module mounted at /disks of a server of its own, over a machine whose read is `read`
async function serve(read)
{
    let asked = 0;
    const server = http.createServer(function (req, res) {
        disks_serve(req, res, {
            read: async function () {
                asked++;
                return read();
            },
            tail: req.url.slice('/disks'.length),
        });
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    return {
        asked: () => asked,
        base: `http://127.0.0.1:${server.address().port}/disks`,
        close: function () {
            server.close();
        },
    };
}

async function fetch_json(url, method)
{
    const answer = await fetch(url, {method});
    return {status: answer.status, body: await answer.json()};
}

test('disks: GET is what the machine answered, read each time', async function () {
    const running = await serve(() => ANSWER);
    try {
        assert.deepStrictEqual(await fetch_json(running.base, 'GET'), {status: 200, body: ANSWER});
        assert.deepStrictEqual(await fetch_json(`${running.base}/`, 'GET'), {status: 200, body: ANSWER});
        assert.strictEqual(running.asked(), 2);
    }
    finally {
        running.close();
    }
});

test('disks: a read that fails says why, with its status or 502', async function () {
    const running = await serve(function () {
        throw new Error('vps1 did not answer in time');
    });
    try {
        assert.deepStrictEqual(await fetch_json(running.base, 'GET'), {status: 502, body: {error: 'vps1 did not answer in time'}});
    }
    finally {
        running.close();
    }
    const refused = await serve(function () {
        throw Object.assign(new Error('vps1 is not connected'), {status: 409});
    });
    try {
        assert.deepStrictEqual(await fetch_json(refused.base, 'GET'), {status: 409, body: {error: 'vps1 is not connected'}});
    }
    finally {
        refused.close();
    }
});

test('disks: any other door or method is a 404, and the machine is not asked', async function () {
    const running = await serve(() => ANSWER);
    try {
        assert.deepStrictEqual(await fetch_json(`${running.base}/other`, 'GET'), {status: 404, body: {error: 'no such door: /other'}});
        assert.deepStrictEqual(await fetch_json(running.base, 'POST'), {status: 404, body: {error: 'no such door: '}});
        assert.strictEqual(running.asked(), 0);
    }
    finally {
        running.close();
    }
});
