const assert = require('assert');
const http = require('http');
const packages_serve = require('../server/packages_serve');
const test = require('node:test');

const ANSWER = {at: 1761164000000, manual_known: true, updates_known: true, items: [{name: 'bash', arch: 'amd64', version: '5.2.21-2ubuntu4', size: 1900000, section: 'shells', summary: 'GNU Bourne Again SHell', manual: true, held: false, broken: false, update: null}], commands: ['apt-mark showmanual', 'apt-mark showhold', 'apt-get -s upgrade']};

// The module mounted at /packages of a server of its own, over a machine whose read is `read`;
// `more` the host's other options, the upgrade's
async function serve(read, more)
{
    let asked = 0;
    const server = http.createServer(function (req, res) {
        packages_serve(req, res, Object.assign({
            read: async function () {
                asked++;
                return read();
            },
            tail: req.url.slice('/packages'.length),
        }, more));
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    return {
        asked: () => asked,
        base: `http://127.0.0.1:${server.address().port}/packages`,
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

test('packages: GET is what the machine answered, read each time', async function () {
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

test('packages: a read that fails says why, with its status or 502', async function () {
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

test('packages: any other door or method is a 404, and the machine is not asked', async function () {
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

test('packages: the upgrade is started, read back while it goes and stopped, each as the host says', async function () {
    const said = [];
    let run = {phase: 'idle', lines: [], started_at: null, ended_at: null, error: null};
    const running = await serve(() => ANSWER, {
        upgrade: function () {
            if (run.phase === 'running') {
                throw Object.assign(new Error('an upgrade is already running on vps1'), {status: 409});
            }
            said.push('upgrade');
            run = {phase: 'running', lines: ['Reading package lists...'], started_at: 1, ended_at: null, error: null};
            return {started: true};
        },
        run: () => run,
        cancel: async function () {
            said.push('cancel');
            run = Object.assign({}, run, {phase: 'cancelled', ended_at: 2});
            return {stopped: true};
        },
    });
    try {
        assert.deepStrictEqual(await fetch_json(`${running.base}/upgrade`, 'POST'), {status: 202, body: {started: true}});
        assert.deepStrictEqual(await fetch_json(`${running.base}/upgrade`, 'POST'), {status: 409, body: {error: 'an upgrade is already running on vps1'}});
        assert.deepStrictEqual((await fetch_json(`${running.base}/upgrade`, 'GET')).body.lines, ['Reading package lists...']);
        assert.deepStrictEqual(await fetch_json(`${running.base}/cancel`, 'POST'), {status: 200, body: {stopped: true}});
        assert.strictEqual((await fetch_json(`${running.base}/upgrade`, 'GET')).body.phase, 'cancelled');
        assert.deepStrictEqual(said, ['upgrade', 'cancel']);
        assert.strictEqual(running.asked(), 0, 'the list is not read for any of it');
    }
    finally {
        running.close();
    }
});

test('packages: a host that installs nothing says so for the upgrade\'s doors', async function () {
    const running = await serve(() => ANSWER);
    try {
        for (const [method, door] of [['POST', '/upgrade'], ['GET', '/upgrade'], ['POST', '/cancel']]) {
            assert.deepStrictEqual(await fetch_json(`${running.base}${door}`, method), {status: 501, body: {error: 'updates are not installed from here'}}, `${method} ${door}`);
        }
    }
    finally {
        running.close();
    }
});
