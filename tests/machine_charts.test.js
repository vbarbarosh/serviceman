const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
const MINUTE = 60000;
const CAN = ['metrics', 'metrics_live'];

// A machine's charts are read once a tick by its page, and its head and History draw the same
// answer: these read the parts that decide what is read and what each one says, as the page
// reads them.

async function module_of(name)
{
    return (await import(path.join(PUBLIC, `${name}.js`))).default;
}

// A remote of the status, online, with what its agent can
function view_of(can, agent_version)
{
    return {name: 'vps1', phase: 'online', left_at: null, agent_version, machine: {can, cpu_busy: 0.2, mem: {used: 2e9, total: 8e9}, disk: {used: 112e9, total: 160e9}}};
}

// An answer of the machine's for a range: `count` points a `step_ms` apart, ending now
function answer_of(range, step_ms, count)
{
    const until = Date.UTC(2026, 10, 26, 12, 0);
    const since = until - count*step_ms;
    const points = [];
    for (let i = 0; i < count; ++i) {
        points.push({at: since + i*step_ms, cpu: (i % 10)/100, mem: 2e9, mem_total: 8e9, disk: 112e9, disk_total: 160e9});
    }
    return {range, since, until, step_ms, points, away: false};
}

// A component's data, computed and methods on one object, as the page reads them
function vm_of(component, fields)
{
    const vm = Object.assign((component.data === undefined) ? {} : component.data(), fields);
    for (const [key, method] of Object.entries(component.methods || {})) {
        vm[key] = method.bind(vm);
    }
    for (const [key, computed] of Object.entries(component.computed || {})) {
        Object.defineProperty(vm, key, {get: () => computed.call(vm)});
    }
    return vm;
}

// The switch's buttons as the page shows them: on with *, disabled with (off)
function said_of(items)
{
    return items.map(v => `${v.label}${v.on ? '*' : ''}${v.disabled ? '(off)' : ''}`).join(' ');
}

// An agent from before the ten minutes is read for the hour; the ranges it has are read as picked
test('a machine\'s charts are read for the range picked, the hour in place of ten minutes it has not', async function () {
    const charts_range_of = await module_of('charts_range_of');
    assert.strictEqual(charts_range_of(view_of(CAN, '1.40.1'), '10m'), '10m');
    assert.strictEqual(charts_range_of(view_of(['metrics'], '1.31.2'), '10m'), '1h');
    assert.strictEqual(charts_range_of(view_of(['metrics'], '1.31.2'), '24h'), '24h');
    assert.strictEqual(charts_range_of(view_of(null, '1.4.0'), '10m'), '1h', 'an agent from before it said what it can');
    assert.strictEqual(charts_range_of({machine: null}, '10m'), '1h', 'a machine never seen');
});

// The ten minutes picked: the rate picked on; the longer ranges: the rate disabled with why, none
// on; an agent from before the ten minutes: those disabled, its version said on them
test('the head\'s switch shows the range read and the rate, and says why what is off is off', async function () {
    const charts_switch = await module_of('charts_switch');
    const live = vm_of(charts_switch, {view: view_of(CAN, '1.40.1'), range: '10m', rate: 2000});
    assert.strictEqual(said_of(live.ranges), '10m* 1h 24h 7d 30d');
    assert.strictEqual(said_of(live.rates), '1s 2s* 5s');
    assert.deepStrictEqual(live.rates.map(v => v.title), ['The ten minutes, read again every second', 'The ten minutes, read again every 2 seconds', 'The ten minutes, read again every 5 seconds']);

    const day = vm_of(charts_switch, {view: view_of(CAN, '1.40.1'), range: '24h', rate: 2000});
    assert.strictEqual(said_of(day.ranges), '10m 1h 24h* 7d 30d');
    assert.strictEqual(said_of(day.rates), '1s(off) 2s(off) 5s(off)');
    assert.strictEqual(day.rates[0].title, '1h and longer gain a point every half minute, and are read every 30 seconds');

    const old = vm_of(charts_switch, {view: view_of(['metrics'], '1.31.2'), range: '1h', rate: 5000});
    assert.strictEqual(said_of(old.ranges), '10m(off) 1h* 24h 7d 30d');
    assert.strictEqual(old.ranges[0].title, 'The ten minutes need agent 1.32 or newer; this machine runs 1.31.2');
    assert.strictEqual(said_of(old.rates), '1s(off) 2s(off) 5s(off)');
    assert.match(old.rates[0].title, /^The ten minutes need agent 1\.32 or newer; this machine runs 1\.31\.2: 1h and longer are read every 30 seconds$/);
});

// The range and the rate are this browser's, the same for every machine: 10m at 2s when it keeps
// none, keeps one the page does not offer, or keeps nothing at all
test('the range and the rate picked are kept in the browser, 10m at 2s where none is', async function () {
    const charts_kept = await module_of('charts_kept');
    const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const kept = new Map();
    const storage = {getItem: v => (kept.has(v) ? kept.get(v) : null), setItem: (name, value) => kept.set(name, String(value))};
    try {
        Object.defineProperty(globalThis, 'localStorage', {configurable: true, get: () => storage});
        assert.deepStrictEqual(charts_kept(), {range: '10m', rate: 2000}, 'none kept');
        storage.setItem('serviceman.charts_range', '7d');
        storage.setItem('serviceman.charts_rate', '5000');
        assert.deepStrictEqual(charts_kept(), {range: '7d', rate: 5000});
        storage.setItem('serviceman.charts_range', '1y');
        storage.setItem('serviceman.charts_rate', '750');
        assert.deepStrictEqual(charts_kept(), {range: '10m', rate: 2000}, 'one the page does not offer');
        Object.defineProperty(globalThis, 'localStorage', {configurable: true, get: function () {
            throw new Error('blocked');
        }});
        assert.deepStrictEqual(charts_kept(), {range: '10m', rate: 2000}, 'a browser that keeps nothing');
    }
    finally {
        if (before === undefined) {
            delete globalThis.localStorage;
        }
        else {
            Object.defineProperty(globalThis, 'localStorage', before);
        }
    }
});

// The head charts CPU, Memory and Disk over whatever range History shows, and says the range in
// its titles; away, the range before it went
test('a machine\'s head charts the range picked, and says it', async function () {
    const remote_facts = await module_of('remote_facts');
    const clock_of = await module_of('clock_of');
    const view = view_of(CAN, '1.40.1');
    const ten = remote_facts(view, answer_of('10m', 1000, 600));
    assert.strictEqual(ten[0].title, 'CPU, the last ten minutes: 0 to 9%');
    assert.ok(ten.every(v => v.spark.line.startsWith('M')), 'a chart under each');
    const day = answer_of('24h', 2*MINUTE, 720);
    assert.strictEqual(remote_facts(view, day)[1].title, 'Memory, the last 24 hours: 25%');
    const away = Object.assign({}, view, {phase: 'offline', left_at: day.until + 20000});
    const gone = remote_facts(away, Object.assign({}, day, {away: true}));
    assert.strictEqual(gone[2].title, `Disk, the 24 hours before ${clock_of(day.until)}: 70%`);
    assert.ok(gone.every(v => v.dim && (v.spark !== null)), 'grey charts');
});

// History draws the answer its page read: the range said beside it, the charts of the range before
// dimmed while another comes, a machine slow to answer keeping the charts shown with why
test('History draws what its page read, and says what it shows', async function () {
    const remote_charts = await module_of('remote_charts');
    const view = view_of(CAN, '1.40.1');
    const first = vm_of(remote_charts, {view, charts: {range: '10m', data: undefined, error: null, old: false, loading: true}});
    assert.strictEqual(first.data, null);
    assert.strictEqual(first.note, 'reading the machine\'s history…');
    assert.strictEqual(first.loading, true);

    const hour = answer_of('1h', 30000, 120);
    const read = vm_of(remote_charts, {view, charts: {range: '1h', data: hour, error: null, old: false, loading: false}});
    assert.strictEqual(read.note, 'the last hour');
    assert.strictEqual(read.plots.length, 7);
    assert.strictEqual(read.values.cpu[0].said, '9%', 'the last point');

    const slow = vm_of(remote_charts, {view, charts: {range: '1h', data: hour, error: 'vps1 did not answer in 10 s', old: false, loading: false}});
    assert.strictEqual(slow.note, 'vps1 did not answer in 10 s');
    assert.strictEqual(slow.data, hour, 'the charts shown stay');

    const coming = vm_of(remote_charts, {view, charts: {range: '30d', data: hour, error: null, old: false, loading: true}});
    assert.strictEqual(coming.loading, true);
    assert.strictEqual(coming.note, 'the last hour', 'said as drawn until the 30 days come');

    const old = vm_of(remote_charts, {view: view_of(null, '1.4.0'), charts: {range: '1h', data: null, error: 'the agent on vps1 is from before charts', old: true, loading: false}});
    assert.strictEqual(old.old, true);
    assert.strictEqual(old.data, null);
});

// An agent from before since/until names its charts' span from and to, and calls the ten
// minutes' `after` since: serviceman says what it answers in the names of now, the page reads
// one kind; an answer of now is passed on as it is
test('the charts of an agent from before are said as since and until', function () {
    const metrics_answer_of = require('../src/main/src/helpers/metrics_answer_of');
    const points = [{at: 30000, cpu: 0.2}];
    assert.deepStrictEqual(metrics_answer_of({range: '1h', from: 0, to: 3600000, step_ms: 30000, points}), {range: '1h', since: 0, until: 3600000, step_ms: 30000, points});
    assert.deepStrictEqual(metrics_answer_of({range: '10m', from: 0, to: 600000, step_ms: 1000, since: 5000, points}), {range: '10m', since: 0, until: 600000, step_ms: 1000, after: 5000, points});
    const now = {range: '10m', since: 0, until: 600000, step_ms: 1000, after: null, points};
    assert.strictEqual(metrics_answer_of(now), now);
});
