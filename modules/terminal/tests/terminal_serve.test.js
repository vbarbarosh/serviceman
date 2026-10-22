const assert = require('assert');
const http = require('http');
const terminal_serve = require('../server/terminal_serve');
const test = require('node:test');

// The module mounted at /terminals of a server of its own, over a machine that keeps `kept`
// terminals and writes down every call; `refuse(method, params)` throws for what its host
// would not let through
async function serve(kept, refuse)
{
    const calls = [];
    const server = http.createServer(function (req, res) {
        terminal_serve(req, res, {
            call: async function (method, params) {
                calls.push([method, params]);
                if (refuse !== undefined) {
                    refuse(method, params);
                }
                if (method === 'term_list') {
                    return {items: kept.map(v => ({name: v}))};
                }
                return {name: params.name, created: (method === 'term_create') ? (kept.includes(params.name) === false) : undefined};
            },
            tail: req.url.slice('/terminals'.length),
        });
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    return {
        calls,
        base: `http://127.0.0.1:${server.address().port}/terminals`,
        close: function () {
            server.close();
        },
    };
}

async function fetch_json(url, method, body)
{
    const answer = await fetch(url, {method, body: (body === undefined) ? undefined : JSON.stringify(body)});
    return {status: answer.status, body: await answer.json()};
}

test('terminal: the list is the machine\'s, a new one takes its name or the first number free', async function () {
    const running = await serve(['1', '2', 'work']);
    try {
        assert.deepStrictEqual(await fetch_json(running.base, 'GET'), {status: 200, body: {items: [{name: '1'}, {name: '2'}, {name: 'work'}]}});
        assert.deepStrictEqual((await fetch_json(running.base, 'POST', {cols: 80, rows: 24})).body, {name: '3', created: true});
        assert.deepStrictEqual((await fetch_json(running.base, 'POST', {name: 'work', env: {A: '1'}, cwd: '/home/user'})).body, {name: 'work', created: false});
        assert.deepStrictEqual(running.calls.filter(v => v[0] === 'term_create').map(v => v[1]), [
            {name: '3', cols: 80, rows: 24, env: undefined, cwd: undefined},
            {name: 'work', cols: undefined, rows: undefined, env: {A: '1'}, cwd: '/home/user'},
        ]);
    }
    finally {
        running.close();
    }
});

test('terminal: one is signalled and ended by its name, and only what those take goes on', async function () {
    const running = await serve(['work']);
    try {
        assert.strictEqual((await fetch_json(`${running.base}/work/signal`, 'POST', {signal: 'SIGINT', to: 'foreground', extra: 1})).status, 200);
        assert.strictEqual((await fetch_json(`${running.base}/work/end`, 'POST')).status, 200);
        assert.deepStrictEqual(running.calls, [
            ['term_signal', {name: 'work', signal: 'SIGINT', to: 'foreground'}],
            ['term_end', {name: 'work'}],
        ]);
    }
    finally {
        running.close();
    }
});

test('terminal: the host\'s refusals keep their status, a machine that fails is a 502, and any other door is a 404', async function () {
    const running = await serve(['work'], function (method, params) {
        if ((method === 'term_create') && (params.cwd === '')) {
            throw Object.assign(new Error('cwd is the path of a folder'), {status: 400});
        }
        if (method === 'term_end') {
            throw new Error('the link dropped before the answer came');
        }
    });
    try {
        assert.deepStrictEqual(await fetch_json(running.base, 'POST', {name: 'x', cwd: ''}), {status: 400, body: {error: 'cwd is the path of a folder'}});
        assert.deepStrictEqual(await fetch_json(`${running.base}/work/end`, 'POST'), {status: 502, body: {error: 'the link dropped before the answer came'}});
        assert.deepStrictEqual(await fetch_json(`${running.base}/work`, 'POST'), {status: 404, body: {error: 'no such door: /work'}});
        assert.deepStrictEqual(await fetch_json(`${running.base}/work/end`, 'GET'), {status: 404, body: {error: 'no such door: /work/end'}});
        const bad = await fetch(running.base, {method: 'POST', body: '{'});
        assert.deepStrictEqual([bad.status, (await bad.json()).error], [400, 'the body is not JSON']);
    }
    finally {
        running.close();
    }
});
