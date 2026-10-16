const assert = require('assert');
const problems_apply = require('../src/main/src/helpers/problems_apply');
const problems_from_containers = require('../src/main/src/helpers/problems_from_containers');
const problems_from_logline = require('../src/main/src/helpers/problems_from_logline');
const test = require('node:test');

const NOW = Date.parse('2026-10-16T09:00:00Z');
const MOUNT_ERROR = 'failed to create task for container: error mounting "/home/user/logline/config/clickhouse.xml" to rootfs at "/etc/clickhouse-server/users.d/log-ui.xml": not a directory';

test('a container Docker was meant to keep running that cannot start is a problem, its missing file named', function () {
    const list = [container('a1', 'logline-clickstack-1', 'exited')];
    const inspect = {a1: inspected('unless-stopped', 'exited', 127, MOUNT_ERROR)};
    const found = problems_from_containers('vps1', list, inspect, []);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].key, 'container_down:vps1:logline-clickstack-1');
    assert.match(found[0].cause, /\/home\/user\/logline\/config\/clickhouse\.xml is not there/);
    assert.match(found[0].fix, /docker start logline-clickstack-1/);
    assert.strictEqual(found[0].since, Date.parse('2026-10-16T05:52:16Z'));
});

test('a container someone stopped, one with no restart policy, and serviceman\'s own are not problems', function () {
    const list = [container('b1', 'stopped-by-hand', 'exited'), container('b2', 'stopped-by-docker-stop', 'exited'), container('b3', 'one-off', 'exited'), container('b4', 'serviceman-echo', 'exited')];
    const inspect = {
        b1: inspected('unless-stopped', 'exited', 0, ''),
        b2: inspected('always', 'exited', 143, ''),
        b3: inspected('no', 'exited', 1, ''),
        b4: inspected('unless-stopped', 'exited', 1, ''),
    };
    assert.deepStrictEqual(problems_from_containers('vps1', list, inspect, []), []);
});

test('a container Docker keeps restarting is a problem', function () {
    const list = [container('c1', 'crashes', 'restarting')];
    const found = problems_from_containers('vps1', list, {c1: inspected('always', 'restarting', 1, '')}, []);
    assert.strictEqual(found.length, 1);
    assert.match(found[0].cause, /again and again/);
});

test('a running container whose mounted files are gone will not come back after a restart', function () {
    const list = [container('d1', 'viewer', 'running'), container('d2', 'fine', 'running')];
    const gone = [{id: 'd1', source: '/home/user/logline/log-ui/index.html'}, {id: 'd1', source: '/home/user/logline/log-ui/app.js'}];
    const found = problems_from_containers('vps1', list, {}, gone);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].key, 'files_gone:vps1:viewer');
    assert.match(found[0].cause, /files it mounts are gone from vps1: \/home\/user\/logline\/log-ui\/index\.html, \/home\/user\/logline\/log-ui\/app\.js/);
});

test('Logline refusing a machine is a problem, and the 401 of another address says to restart Docker', function () {
    const found = problems_from_logline('vps1', logline('401 not from an address this token was issued for', '2026-10-08T11:50:16Z', 690000, 250e6), NOW);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].key, 'logline_refused:vps1');
    assert.match(found[0].fix, /restart Docker/);
    assert.strictEqual(found[0].since, Date.parse('2026-10-08T11:50:16Z'));
});

test('lines that wait while nothing went for ten minutes are a problem; a machine that sends is not', function () {
    const silent = logline('ok', '2026-10-16T08:40:00Z', 10, 1000);
    silent.last_sent_at = '2026-10-16T08:45:00Z';
    assert.strictEqual(problems_from_logline('vps1', silent, NOW)[0].key, 'logline_silent:vps1');
    const sending = logline('ok', '2026-10-16T08:59:58Z', 10, 1000);
    sending.last_sent_at = '2026-10-16T08:59:59Z';
    assert.deepStrictEqual(problems_from_logline('vps1', sending, NOW), []);
});

test('a store near its cap is a problem, and one at its cap says collecting has stopped', function () {
    const near = problems_from_logline('vps1', logline('ok', null, 1, 850*1024*1024), NOW);
    assert.match(near[0].subject, /near the limit/);
    const full = problems_from_logline('vps1', logline('ok', null, 1, 1024*1024*1024), NOW);
    assert.match(full[0].subject, /stopped collecting/);
});

test('a machine that does not collect, or an agent that says nothing yet, has no Logline problem', function () {
    assert.deepStrictEqual(problems_from_logline('vps1', null, NOW), []);
    assert.deepStrictEqual(problems_from_logline('vps1', Object.assign(logline('500 down', null, 5, 10), {collecting: false}), NOW), []);
});

test('a problem shows once seen twice a check apart, is said when it shows, and again when it is gone', function () {
    const app = {log_lines: [], file_log: null, log_group: null, log_stdout_time: true, problems: new Map()};
    const item = {key: 'k', kind: 'remote', remote: 'vps1', subject: 'vps1 is offline', cause: 'its agent is not dialled in', fix: 'see it', since: null};
    problems_apply(app, [item], NOW);
    assert.strictEqual(app.problems.get('k').shown, false);
    assert.strictEqual(app.log_lines.length, 0);
    problems_apply(app, [item], NOW + 60*1000);
    assert.strictEqual(app.problems.get('k').shown, true);
    assert.match(app.log_lines[0], /\[problem_begin\] remote=vps1 subject="vps1 is offline"/);
    problems_apply(app, [], NOW + 120*1000);
    assert.strictEqual(app.problems.size, 0);
    assert.match(app.log_lines[1], /\[problem_end\] remote=vps1 subject="vps1 is offline" lasted=/);
});

test('a problem gone before it was seen twice is never said', function () {
    const app = {log_lines: [], file_log: null, log_group: null, log_stdout_time: true, problems: new Map()};
    problems_apply(app, [{key: 'k', kind: 'service', remote: null, subject: 'x does not answer', cause: 'refused', fix: 'restart it', since: null}], NOW);
    problems_apply(app, [], NOW + 60*1000);
    assert.strictEqual(app.log_lines.length, 0);
});

function container(id, name, state)
{
    return {Id: id, Names: [`/${name}`], State: state, Mounts: []};
}

function inspected(policy, status, code, error)
{
    return {HostConfig: {RestartPolicy: {Name: policy}}, State: {Status: status, ExitCode: code, Error: error, FinishedAt: '2026-10-16T05:52:16Z'}};
}

function logline(answer, oldest, lines, bytes)
{
    return {
        collecting: true,
        waiting: {lines, bytes, oldest},
        cap_bytes: 1024*1024*1024,
        last_sent_at: '2026-10-16T08:59:00Z',
        last_answer: answer,
    };
}
