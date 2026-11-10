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

test('an agent whose spool folder cannot be written goes on, says so once, and its lines arrive once it can be', {skip: (process.getuid() === 0) ? 'root writes into every folder' : false}, async function (t) {
    const world = await world_make(t);
    const spool = path.join(world.agent_dir, 'logline', 'spool');
    fs.mkdirSync(spool, {recursive: true});
    fs.chmodSync(spool, 0o500);
    t.after(() => fs.chmodSync(spool, 0o700));
    const web = world.docker.add('web');
    const floor = world.docker.now();
    world.docker.log(web, 'written while the folder was read-only');
    world.agent_start(floor);
    // Five syncs' time: an agent the first of them stopped is gone by now
    await timers.setTimeout(1000);
    assert.strictEqual(world.agent_alive(), true, 'the agent is still there');
    fs.chmodSync(spool, 0o700);
    await world.until(() => (world.rows().length === 1) && world.own().some(v => v.LogAttributes.sender === 'logline_spool_ok'));
    assert.deepStrictEqual(world.rows().map(v => v.Body), ['written while the folder was read-only']);
    assert.deepStrictEqual(world.own().map(v => v.LogAttributes.sender).filter(v => v.startsWith('logline_spool_')), ['logline_spool_error', 'logline_spool_ok'], 'said once when it began, and once when it was over');
});

test('lines the store will never take hold nothing back: a batch of too many days goes in by halves, a time the store cannot hold is put aside, and every line behind arrives', async function (t) {
    const world = await world_make(t);
    const web = world.docker.add('web');
    const floor = world.docker.now();
    const written = [];
    // A line a day for 150 days, each with its own time, as a file read from its start has them:
    // more days than ClickHouse lets one insert span
    for (let i = 0; i < 150; i++) {
        world.docker.log(web, `${new Date(Date.UTC(2026, 0, 1 + i)).toISOString()} [c7t0xb1m][day_done] day ${i}`);
        written.push(`[c7t0xb1m][day_done] day ${i}`);
    }
    world.agent_start(floor);
    await world.until(() => world.rows().length >= written.length);
    const refused = path.join(world.agent_dir, 'logline', 'spool', 'refused');
    assert.strictEqual(fs.existsSync(refused), false, 'no line of the 150 days is put aside: halved, the batch is one the store takes');

    world.docker.log(web, '9999-12-31T00:00:00.000Z [c7t0xb1m][far_off] a time the table cannot hold');
    world.docker.log(web, 'the line behind them');
    written.push('the line behind them');
    await world.until(() => world.rows().length >= written.length);
    assert.deepStrictEqual(world.rows().map(v => v.Body).sort(), written.slice().sort(), 'every line the store can take, once');
    await world.until(() => world.own().some(v => v.LogAttributes.sender === 'logline_batch_refused'));
    const names = fs.readdirSync(refused);
    assert.strictEqual(names.length, 1, 'one line is put aside, and not the batch it came in');
    const kept = JSON.parse(fs.readFileSync(path.join(refused, names[0]), 'utf8'));
    assert.deepStrictEqual(kept.batch.map(v => [v.time, v.line]), [['9999-12-31T00:00:00.000000000Z', '[c7t0xb1m][far_off] a time the table cannot hold']]);
    assert.match(kept.answer, /^422 clickhouse 500: Code: 407\. DB::Exception: Decimal math overflow/, 'with what the store said');
    const said = world.own().filter(v => v.LogAttributes.sender.startsWith('logline_batch_') || v.LogAttributes.sender.startsWith('logline_ship_'));
    assert.deepStrictEqual(said.map(v => v.LogAttributes.sender), ['logline_batch_refused'], 'said once, and Logline is never said to be away');
    assert.match(said[0].Body, new RegExp(`lines=1 reason="422 clickhouse 500: Code: 407\\. DB::Exception: Decimal math overflow[^"]*" kept=refused/${names[0].replace('.', '\\.')}$`));
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
        agent_alive: () => (agent !== null) && (agent.exitCode === null) && (agent.signalCode === null),
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
// dedup token already was. One whose lines it will never take is refused whole, with the
// number and the words ClickHouse's source has for it: a time past what DateTime64(9) holds, or
// more than a hundred days in one insert.
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
            const rows = url.searchParams.get('query').startsWith('INSERT') ? body.split('\n').filter(v => v !== '').map(v => JSON.parse(v)) : [];
            if (rows.some(v => v.Timestamp.slice(0, 10) > '2262-04-11')) {
                res.writeHead(500, {'x-clickhouse-exception-code': '407'});
                res.end('Code: 407. DB::Exception: Decimal math overflow: (while reading the value of key Timestamp): (at row 1)\n: While executing ParallelParsingBlockInputFormat. (DECIMAL_OVERFLOW)\n');
                return;
            }
            if (new Set(rows.map(v => v.Timestamp.slice(0, 10))).size > 100) {
                res.writeHead(500, {'x-clickhouse-exception-code': '252'});
                res.end('Code: 252. DB::Exception: Too many partitions for single INSERT block (more than 100). The limit is controlled by \'max_partitions_per_insert_block\' setting. (TOO_MANY_PARTS)\n');
                return;
            }
            if ((rows.length > 0) && (out.tokens.has(token) === false)) {
                out.tokens.add(token);
                out.rows.push(...rows);
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
