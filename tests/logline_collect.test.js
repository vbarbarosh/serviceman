const assert = require('assert');
const child_process = require('child_process');
const crypto = require('crypto');
const fake_docker_engine = require('./fake_docker_engine');
const fs = require('fs');
const http = require('http');
const lines_serve = require('../logline/lines/src/lines_serve');
const os = require('os');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');

test('every line a container writes after the floor reaches Logline once, and none from before', async function (t) {
    const world = await world_make(t);
    const web = world.docker.add('web', {labels: {'com.docker.compose.service': 'web', 'com.docker.compose.project': 'shop'}});
    world.docker.log(web, 'before the floor');
    const floor = world.docker.now();
    world.docker.log(web, 'first');
    world.docker.log(web, 'an error', 'stderr');
    world.docker.log(web, '2026-09-25T19:48:10.059Z [c7t0xb1m][worker_begin] carries its own time');
    world.docker.add('logline-self', {labels: {logline: 'off'}});
    world.agent_start(floor);

    await world.until(() => world.rows().length === 3);
    world.docker.log(web, 'after the agent came');
    // A container that starts later
    const job = world.docker.add('job');
    world.docker.log(job, 'job line');
    // One serviceman made, which says which of its services it is: the line is that service's
    const notes = world.docker.add('serviceman-notes', {labels: {'serviceman.service': 'notes'}});
    world.docker.log(notes, 'notes line');
    await world.until(() => world.rows().length === 6);
    const rows = world.rows();
    assert.deepStrictEqual(rows.map(v => v.Body).sort(), ['[c7t0xb1m][worker_begin] carries its own time', 'after the agent came', 'an error', 'first', 'job line', 'notes line'].sort());
    assert.strictEqual(rows.find(v => v.Body === 'notes line').ServiceName, 'notes');
    assert.strictEqual(rows.find(v => v.Body === 'job line').ServiceName, 'job');
    const first = rows.find(v => v.Body === 'first');
    assert.strictEqual(first.ServiceName, 'web');
    assert.deepStrictEqual(first.ResourceAttributes, {'remote': 'box1', 'host.name': 'testbox', 'service.namespace': 'shop', 'container.name': 'web', 'container.id': web.slice(0, 12), 'container.image.name': 'demo/image'});
    assert.strictEqual(rows.find(v => v.Body === 'an error').LogAttributes['log.iostream'], 'stderr');
    assert.strictEqual(rows.find(v => v.Body.startsWith('[c7t0xb1m]')).Timestamp, '2026-09-25T19:48:10.059000000Z', 'the line\'s own time, taken off the line');
    assert.strictEqual(rows.some(v => v.Body === 'before the floor'), false);
    assert.strictEqual(rows.some(v => v.ResourceAttributes['container.name'] === 'logline-self'), false);

    // The agent's own lines go the same way, the ones it said before collection began included
    await world.until(() => world.own().some(v => v.LogAttributes.sender === 'logline_collect_begin'));
    const own = world.own();
    assert.strictEqual(own.some(v => v.LogAttributes.sender === 'agent_begin'), true, 'said before collection started, kept until it had');
    const begin = own.find(v => v.LogAttributes.sender === 'logline_collect_begin');
    assert.match(begin.Body, /^\[c[0-9a-z]{11}\]\[logline_collect_begin\] floor=/, 'the line without its time, which is beside it');
    assert.deepStrictEqual(begin.ResourceAttributes, {'remote': 'box1', 'host.name': 'testbox'});
});

test('killed at any moment, and with Logline away for a while, the agent loses no line and sends none twice', async function (t) {
    const world = await world_make(t);
    const ids = [world.docker.add('a'), world.docker.add('b')];
    const floor = world.docker.now();
    world.agent_start(floor);
    const written = [];
    let writing = true;
    const writer = (async function () {
        for (let i = 0; writing; i++) {
            const id = ids[i % 2];
            const text = `line ${i} of ${id.slice(0, 1)}`;
            world.docker.log(id, text, (i % 7 === 0) ? 'stderr' : 'stdout');
            written.push(text);
            await timers.setTimeout(2);
        }
    })();
    for (let round = 0; round < 4; round++) {
        await timers.setTimeout(250 + Math.floor(Math.random()*250));
        world.agent_kill();
        if (round === 1) {
            // Logline is away while the agent comes back
            world.lines_down();
            world.agent_start(floor);
            await timers.setTimeout(400);
            world.lines_up();
        }
        else {
            world.agent_start(floor);
        }
    }
    // A container that starts and stops while the agent is down
    world.agent_kill();
    const brief = world.docker.add('brief');
    world.docker.log(brief, 'brief line');
    world.docker.stop(brief);
    written.push('brief line');
    world.agent_start(floor);
    writing = false;
    await writer;
    await world.until(() => world.rows().length >= written.length, 20000);
    await timers.setTimeout(500);
    const got = world.rows().map(v => v.Body);
    assert.strictEqual(got.length, written.length, 'no line twice');
    assert.deepStrictEqual(got.slice().sort(), written.slice().sort(), 'and no line missing');
});

test('at its cap the spool stops reading, and every line still arrives once Logline is back', async function (t) {
    const world = await world_make(t, {SERVICEMAN_LOGLINE_CAP: String(40*1024)});
    const id = world.docker.add('noisy');
    const floor = world.docker.now();
    world.lines_down();
    world.agent_start(floor);
    const written = [];
    for (let i = 0; i < 1500; i++) {
        const text = `noise ${i} ${'x'.repeat(60)}`;
        world.docker.log(id, text);
        written.push(text);
    }
    await timers.setTimeout(1500);
    const spool = path.join(world.agent_dir, 'logline', 'spool');
    const held = fs.readdirSync(spool).filter(v => v.endsWith('.jsonl')).map(v => fs.statSync(path.join(spool, v)).size).reduce((a, b) => a + b, 0);
    assert.strictEqual(held < 40*1024 + 64*1024, true, `the spool keeps near its cap (${held} bytes)`);
    world.lines_up();
    await world.until(() => world.rows().length >= written.length, 30000);
    assert.deepStrictEqual(world.rows().map(v => v.Body).sort(), written.slice().sort());
});

// A docker engine, Logline's endpoint in front of a ClickHouse that keeps one copy of a batch
// sent twice, and an agent told to send there
async function world_make(t, env)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-collect-'));
    const docker = await fake_docker_engine(path.join(dir, 'docker.sock'));
    const clickhouse = await clickhouse_fake(t);
    const lines_port = await port_free();
    const tokens_file = path.join(dir, 'tokens.json');
    let lines = null;
    async function lines_up() {
        lines = lines_serve({admin_token: ADMIN_TOKEN, admin_ips: ['127.0.0.1'], clickhouse: `http://127.0.0.1:${clickhouse.port}`, table: 'default.otel_logs', tokens_file, uid: 'ctest0000000'});
        await new Promise(v => lines.listen(lines_port, '127.0.0.1', v));
    }
    await lines_up();
    const issued = await fetch(`http://127.0.0.1:${lines_port}/tokens`, {method: 'POST', headers: {authorization: `Bearer ${ADMIN_TOKEN}`}, body: JSON.stringify({name: 'box1', ips: ['127.0.0.1']})}).then(v => v.json());
    const agent_dir = path.join(dir, 'agent');
    let agent = null;
    t.after(function () {
        if (agent !== null) {
            agent.kill('SIGKILL');
        }
        if (lines !== null) {
            lines.closeAllConnections();
            lines.close();
        }
        docker.close();
    });
    return {
        docker,
        agent_dir,
        // What the containers wrote; the agent's own lines are counted apart
        rows: () => clickhouse.rows.filter(v => v.ServiceName !== 'serviceman-agent'),
        own: () => clickhouse.rows.filter(v => v.ServiceName === 'serviceman-agent'),
        agent_start: function (floor) {
            fs.mkdirSync(path.join(agent_dir, 'logline'), {recursive: true});
            fs.writeFileSync(path.join(agent_dir, 'logline', 'settings.json'), JSON.stringify({endpoint: `http://127.0.0.1:${lines_port}/lines`, token: issued.token, logs: 'all', floor}));
            agent = child_process.spawn(process.execPath, [AGENT, '--url', 'http://127.0.0.1:9', '--token', 'fedcba9876543210fedcba9876543210'], {
                stdio: ['ignore', 'pipe', 'pipe'],
                // Lines gather 200ms here, not the ten seconds of a machine
                env: Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: agent_dir, DOCKER_HOST: `unix://${path.join(dir, 'docker.sock')}`, SERVICEMAN_MACHINE: 'testbox', SERVICEMAN_LOG_DIR: 'none', SERVICEMAN_LOGLINE_GATHER: '200'}, env),
            });
            if (process.env.AGENT_OUT) {
                agent.stdout.pipe(process.stderr);
            }
            else {
                agent.stdout.resume();
            }
            agent.stderr.resume();
        },
        agent_kill: function () {
            agent.kill('SIGKILL');
            agent = null;
        },
        lines_down: function () {
            lines.closeAllConnections();
            lines.close();
            lines = null;
        },
        lines_up,
        until: async function (ready, timeout_ms) {
            const deadline = Date.now() + ((timeout_ms === undefined) ? 10000 : timeout_ms);
            while (ready() === false) {
                if (Date.now() > deadline) {
                    throw new Error(`the condition never came true (${clickhouse.rows.length} rows)`);
                }
                await timers.setTimeout(50);
            }
        },
    };
}

// ClickHouse as far as the endpoint uses it: an insert is stored, unless a batch with the same
// dedup token already was
async function clickhouse_fake(t)
{
    const out = {rows: [], tokens: new Set()};
    const server = http.createServer(function (req, res) {
        const url = new URL(req.url, 'http://clickhouse');
        let body = '';
        req.on('data', function (chunk) {
            body += chunk;
        });
        req.on('end', function () {
            const token = url.searchParams.get('insert_deduplication_token');
            if (url.searchParams.get('query').startsWith('INSERT') && (out.tokens.has(token) === false)) {
                out.tokens.add(token);
                for (const line of body.split('\n').filter(v => v !== '')) {
                    out.rows.push(JSON.parse(line));
                }
            }
            res.end('');
        });
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(function () {
        server.closeAllConnections();
        server.close();
    });
    out.port = server.address().port;
    return out;
}

async function port_free()
{
    const server = http.createServer();
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    const out = server.address().port;
    await new Promise(v => server.close(v));
    return out;
}
