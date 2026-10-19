const assert = require('assert');
const health_from_views = require('../src/main/src/helpers/health_from_views');
const test = require('node:test');

const NOW = Date.parse('2026-10-16T09:00:00Z');
const GB = 1024**3;

test('a machine that works is green on every check it has', function () {
    const health = health_from_views(views({remotes: [remote('vps1')]}), seen({'docker:vps1': ok('7 running'), 'firewall:vps1': ok('on, 6 rules')}));
    const row = area(health, 'machines').rows[0];
    assert.strictEqual(row.state, 'ok');
    assert.deepStrictEqual(row.checks.map(v => v.key), ['link', 'agent', 'disk', 'memory', 'cpu', 'updates', 'docker', 'firewall', 'doors']);
    assert.ok(row.checks.every(v => v.state === 'ok'), JSON.stringify(row.checks));
    assert.strictEqual(check_of(row, 'link').text, 'online, 40 ms');
    assert.strictEqual(check_of(row, 'docker').text, '7 running');
    assert.deepStrictEqual(health.counts, {bad: 0, warn: 0, none: 0, ok: 3}, 'the machine, Logline and the machine\'s lines');
});

test('a machine that went is red, says for how long, and has nothing else to say', function () {
    const away = remote('vps1', {phase: 'offline', left_at: NOW - 3*3600*1000, machine: null});
    const health = health_from_views(views({remotes: [away]}), seen({}));
    const row = area(health, 'machines').rows[0];
    assert.strictEqual(row.state, 'bad');
    assert.deepStrictEqual(row.checks.map(v => v.key), ['link']);
    assert.strictEqual(row.checks[0].text, 'offline for 3h 0s');
});

test('a machine that never dialled in is not missed', function () {
    const health = health_from_views(views({remotes: [remote('laptop', {phase: 'offline', machine: null})]}), seen({}));
    assert.strictEqual(area(health, 'machines').rows[0].state, 'none');
});

test('a full disk, a stuck agent, security updates and a firewall that is off are said as such', function () {
    const crowded = remote('vps2', {agent_built: 'old', agent_version: '1.17.0', update_refused: 'cannot write ~/serviceman-agent'});
    crowded.machine.disk.free = 0.02*crowded.machine.disk.total;
    crowded.machine.updates = {pending: 9, security: 3, reboot: false};
    const health = health_from_views(views({remotes: [crowded]}), seen({'firewall:vps2': {state: 'warn', text: 'off', detail: null}}));
    const row = area(health, 'machines').rows[0];
    assert.strictEqual(row.state, 'bad');
    assert.strictEqual(check_of(row, 'disk').state, 'bad');
    assert.strictEqual(check_of(row, 'agent').state, 'warn');
    assert.strictEqual(check_of(row, 'agent').text, '1.17.0, will not update');
    assert.strictEqual(check_of(row, 'updates').text, '3 security');
    assert.strictEqual(check_of(row, 'firewall').state, 'warn');
    assert.strictEqual(check_of(row, 'docker').text, 'not asked yet', 'the first minute has nothing to say yet');
});

test('a container problem turns the machine\'s Docker red, in the problem\'s words', function () {
    const problem = {key: 'container_down:vps1:logline-clickstack-1', kind: 'container', remote: 'vps1', subject: 'logline-clickstack-1 is down on vps1', cause: 'Docker cannot start it', fix: 'docker start logline-clickstack-1'};
    const health = health_from_views(views({remotes: [remote('vps1')], problems: [problem]}), seen({'docker:vps1': ok('6 running, 1 not')}));
    const docker = check_of(area(health, 'machines').rows[0], 'docker');
    assert.strictEqual(docker.state, 'bad');
    assert.strictEqual(docker.text, 'logline-clickstack-1 is down', 'the row names the machine already');
    assert.match(docker.detail, /docker start logline-clickstack-1/);
});

test('a sleeping service is grey, not broken; a failed one and one that does not answer are red', function () {
    const asleep = service('docs', {phase: 'stopped'});
    const failed = service('api', {phase: 'failed', error: 'exit 1'});
    const silent = service('viewer', {phase: 'running', instances: [{slot: 1, phase: 'running', remote: 'vps1'}]});
    const answering = service('echo', {phase: 'running', instances: [{slot: 1, phase: 'running', remote: null}]});
    const problem = {key: 'service_silent:viewer:1', kind: 'service', remote: 'vps1', service: 'viewer', subject: 'viewer does not answer', cause: 'nothing answers at 127.0.0.1:8081 on vps1: connect ECONNREFUSED', fix: 'Restart it'};
    const health = health_from_views(views({services: [asleep, failed, silent, answering], problems: [problem]}), seen({'service:echo:1': ok('in 3 ms')}));
    const rows = area(health, 'services').rows;
    assert.deepStrictEqual(rows.map(v => v.state), ['none', 'bad', 'bad', 'ok']);
    assert.strictEqual(rows[0].checks[0].text, 'asleep');
    assert.strictEqual(rows[2].checks[1].text, 'not on vps1');
    assert.strictEqual(rows[3].checks[1].text, 'in 3 ms');
});

test('Logline down, a machine it refuses, and one near its cap', function () {
    const refused = remote('vps1', {logline: logline_of({last_answer: '401 not from an address this token was issued for'})});
    const full = remote('vps2', {logline: logline_of({waiting: {lines: 2144009, bytes: 950e6, oldest: '2026-10-08T00:00:00Z'}})});
    const quiet = remote('laptop', {logline: Object.assign(logline_of({}), {logs: 'off'})});
    const problems = [
        {key: 'logline_refused:vps1', kind: 'logline', remote: 'vps1', subject: 'Logline does not take vps1\'s lines', cause: 'it answers "401"', fix: 'restart Docker there'},
        {key: 'logline_full:vps2', kind: 'logline', remote: 'vps2', subject: 'vps2\'s lines near the limit', cause: '906 MB of 954 MB', fix: 'let Logline take them'},
    ];
    const health = health_from_views(views({remotes: [refused, full, quiet], problems}), seen({'logline:ui': {state: 'bad', text: 'does not answer', detail: 'ECONNREFUSED'}}));
    const logline = area(health, 'logline').rows[0];
    assert.strictEqual(check_of(logline, 'viewer').state, 'bad');
    assert.strictEqual(check_of(logline, 'store').state, 'ok', 'vps2 had its lines taken a moment ago');
    assert.strictEqual(logline.state, 'bad');
    const rows = area(health, 'lines').rows;
    assert.deepStrictEqual(rows.map(v => v.key), ['logs:vps1', 'logs:vps2'], 'a machine that sends no lines has no row');
    assert.strictEqual(check_of(rows[0], 'sending').state, 'bad');
    assert.strictEqual(check_of(rows[1], 'waiting').state, 'warn');
    assert.strictEqual(check_of(rows[1], 'waiting').text, '2,144,009 lines, near the limit');
    assert.strictEqual(check_of(rows[1], 'sending').state, 'ok');
});

test('Logline\'s store is judged by what the machines hear, not asked from here', function () {
    const sending = remote('vps1');
    const refused = remote('vps2', {logline: logline_of({last_answer: '401 not from an address this token was issued for'})});
    assert.strictEqual(check_of(area(health_from_views(views({remotes: [sending, refused]}), seen({})), 'logline').rows[0], 'store').state, 'ok');
    const all_refused = health_from_views(views({remotes: [refused]}), seen({}));
    assert.strictEqual(check_of(area(all_refused, 'logline').rows[0], 'store').text, 'refuses every machine');
    const one = remote('vps1', {logline: logline_of({waiting: {lines: 1, bytes: 300, oldest: null}})});
    assert.strictEqual(check_of(area(health_from_views(views({remotes: [one]}), seen({})), 'lines').rows[0], 'waiting').text, '1 line');
});

test('nothing set up is said, not counted as broken', function () {
    const health = health_from_views(views({logline: null}), seen({}));
    assert.deepStrictEqual(health.areas.map(v => [v.key, v.rows.length]), [['machines', 0], ['services', 0], ['logline', 1], ['lines', 0], ['forwards', 0]]);
    assert.strictEqual(area(health, 'logline').rows[0].state, 'none');
    assert.deepStrictEqual(health.counts, {bad: 0, warn: 0, none: 1, ok: 0});
    assert.strictEqual(health.checked_at, null);
});

test('a forward that cannot listen is red, one set aside is grey', function () {
    const forwards = [{label: 'loki', state: 'ready', problem: null}, {label: 'db', state: 'cannot_listen', problem: 'vps1 cannot listen: EADDRINUSE'}, {label: 'old', state: 'aside', problem: 'set aside'}];
    const rows = area(health_from_views(views({forwards}), seen({})), 'forwards').rows;
    assert.deepStrictEqual(rows.map(v => v.state), ['ok', 'bad', 'none']);
    assert.strictEqual(rows[1].checks[0].detail, 'vps1 cannot listen: EADDRINUSE');
});

function views(over)
{
    return Object.assign({now: NOW, agent_built: 'b1', logline: {endpoint: 'http://192.0.2.10:3000/lines', ui: 'http://192.0.2.10:8081/', admin: 'logline', admin_kept: true}, services: [], remotes: [], forwards: [], problems: []}, over);
}

function seen(items)
{
    return {checked_at: (Object.keys(items).length === 0) ? null : NOW - 20000, items: new Map(Object.entries(items))};
}

function ok(text)
{
    return {state: 'ok', text, detail: null};
}

function remote(name, over)
{
    return Object.assign({
        name,
        title: null,
        phase: 'online',
        agent_version: '1.18.0',
        agent_built: 'b1',
        update_refused: null,
        uptime_ms: 3600*1000,
        left_at: null,
        latency_ms: 40,
        error: null,
        doors: {told: 'v2', wanted: 'v2', peer: '100.64.0.20', error: null},
        machine: {
            docker: 'docker 27.3.1',
            mem: {total: 8*GB, free: 3*GB},
            disk: {path: '/', total: 80*GB, free: 40*GB},
            load: 0.4,
            cpu_busy: 0.12,
            updates: {pending: 0, security: 0, reboot: false},
        },
        logline: logline_of({}),
    }, over);
}

function logline_of(status)
{
    return {
        logs: 'on',
        error: null,
        status: Object.assign({collecting: true, sent: {lines: 1200, batches: 4, bytes: 4e5}, waiting: {lines: 0, bytes: 0, oldest: null}, cap_bytes: 1e9, last_sent_at: '2026-10-16T08:59:30Z', last_answer: 'ok', dir_errors: {}}, status),
    };
}

function service(name, over)
{
    return Object.assign({name, title: null, type: 'docker', phase: 'running', gave_up: false, error: null, uptime_ms: 60000, instances: []}, over);
}

function area(health, key)
{
    return health.areas.find(v => v.key === key);
}

function check_of(row, key)
{
    return row.checks.find(v => v.key === key);
}
