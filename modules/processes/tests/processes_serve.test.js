const assert = require('assert');
const http = require('http');
const processes_serve = require('../server/processes_serve');
const test = require('node:test');

const ANSWER = {at: 1761164000000, cpu_window_ms: 500, items: [{pid: 1, ppid: 0, user: 'root', cpu: 0, mem: 0.1, rss: 819200, elapsed_ms: 629000, state: 'Ss', command: '/sbin/init'}], commands: ['ps -eo pid=,ppid=,user:32=,pcpu=,pmem=,rss=,etimes=,stat=,args=']};

// The module mounted at /processes of a server of its own, over a machine whose read is `read`
async function serve(read)
{
    let asked = 0;
    const server = http.createServer(function (req, res) {
        processes_serve(req, res, {
            read: async function () {
                asked++;
                return read();
            },
            tail: req.url.slice('/processes'.length),
        });
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    return {
        asked: () => asked,
        base: `http://127.0.0.1:${server.address().port}/processes`,
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

test('processes: GET is what the machine answered, read each time', async function () {
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

test('processes: a read that fails says why, with its status or 502', async function () {
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

test('processes: any other door or method is a 404, and the machine is not asked', async function () {
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
