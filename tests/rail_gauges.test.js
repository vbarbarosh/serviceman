const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
const GB = 1024*1024*1024;

async function rail_gauges_of()
{
    return (await import(path.join(PUBLIC, 'rail_gauges.js'))).default;
}

// A machine as the status lists it, linked, its numbers as shares: null for one it does not say
function remote_of(cpu, memory, disk)
{
    return {
        name: 'vps1',
        phase: 'online',
        unanswered: null,
        machine: {
            cpu_busy: cpu,
            mem: {total: 64*GB, free: (memory === null) ? null : (1 - memory)*64*GB},
            disk: {path: '/', total: 400*GB, free: (disk === null) ? null : (1 - disk)*400*GB},
        },
    };
}

// The bars as words: its number, its height, its colour
function told(gauges)
{
    return gauges.gauges.map(v => `${v.key} ${v.height}${(v.level === '') ? '' : ` ${v.level}`}`);
}

test('a machine in the rail shows a bar for each number ticked on its Overview, in the order they stand there', async function () {
    const rail_gauges = await rail_gauges_of();
    const gauges = rail_gauges(remote_of(0.5, 0.37, 0.3), ['memory', 'cpu']);
    assert.deepStrictEqual(told(gauges), ['cpu 50%', 'memory 37%'], 'CPU before memory, whatever order they were ticked in');
    assert.strictEqual(gauges.title, 'CPU 50% · Memory 37%');
    assert.strictEqual(gauges.stale, false);
    assert.deepStrictEqual(told(rail_gauges(remote_of(0.5, 0.37, 0.3), ['disk', 'memory', 'cpu'])), ['cpu 50%', 'memory 37%', 'disk 30%']);
    assert.deepStrictEqual(told(rail_gauges(remote_of(0.5, 0.37, 0.3), ['disk'])), ['disk 30%'], 'one ticked, one bar');
});

test('a bar turns amber from 80% and red from 92%, as the tiles do', async function () {
    const rail_gauges = await rail_gauges_of();
    assert.deepStrictEqual(told(rail_gauges(remote_of(0.95, 0.84, 0.79), ['cpu', 'memory', 'disk'])), ['cpu 95% full', 'memory 84% filling', 'disk 79%']);
    assert.deepStrictEqual(told(rail_gauges(remote_of(0.92, 0.8, 1), ['cpu', 'memory', 'disk'])), ['cpu 92% full', 'memory 80% filling', 'disk 100% full']);
});

test('an idle machine\'s bar is told from one with no number, and a number past its bounds stays in its bar', async function () {
    const rail_gauges = await rail_gauges_of();
    const gauges = rail_gauges(remote_of(0, null, 1.3), ['cpu', 'memory', 'disk']);
    assert.deepStrictEqual(told(gauges), ['cpu 8%', 'memory 0% none', 'disk 100% full'], 'idle keeps a sliver; no number is an empty bar');
    assert.strictEqual(gauges.title, 'CPU 0% · Memory not measured · Disk 100%');
    const silent = remote_of(null, null, null);
    silent.machine.mem.total = 0;
    assert.deepStrictEqual(told(rail_gauges(silent, ['cpu', 'memory', 'disk'])), ['cpu 0% none', 'memory 0% none', 'disk 0% none'], 'servermon off, and a machine that says no memory at all');
});

test('a machine shows no bars while it is not linked, or when nothing is ticked', async function () {
    const rail_gauges = await rail_gauges_of();
    assert.strictEqual(rail_gauges(remote_of(0.5, 0.5, 0.5), []), null);
    assert.strictEqual(rail_gauges(Object.assign(remote_of(0.5, 0.5, 0.5), {phase: 'offline'}), ['cpu']), null, 'what it said last is old: its red dot says it is away');
    assert.strictEqual(rail_gauges(Object.assign(remote_of(0.5, 0.5, 0.5), {phase: 'greeting'}), ['cpu']), null);
    assert.strictEqual(rail_gauges(Object.assign(remote_of(0.5, 0.5, 0.5), {machine: null}), ['cpu']), null, 'not connected since serviceman started');
});

test('a machine that does not answer keeps its bars, faint, and its title says they are what it said last', async function () {
    const rail_gauges = await rail_gauges_of();
    const remote = Object.assign(remote_of(0.5, 0.6, 0.2), {unanswered: {method: 'term_list', ms: 14000, heard_ms: 2000, carrying: null}});
    const gauges = rail_gauges(remote, ['cpu', 'memory']);
    assert.strictEqual(gauges.stale, true);
    assert.deepStrictEqual(told(gauges), ['cpu 50%', 'memory 60%']);
    assert.match(gauges.title, /^CPU 50% · Memory 60%, as it said last\. Not answering for 14s: serviceman asked it term_list/);
});
