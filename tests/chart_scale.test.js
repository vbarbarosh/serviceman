const assert = require('assert');
const path = require('path');
const test = require('node:test');

// The times are said in the browser's zone: here, UTC
process.env.TZ = 'UTC';

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
const MINUTE = 60000;
const HOUR = 60*MINUTE;
const DAY = 24*HOUR;
const MB = 1024*1024;
const NOW = Date.UTC(2026, 10, 26, 12, 2);

async function module_of(name)
{
    return (await import(path.join(PUBLIC, `${name}.js`))).default;
}

// A day and a time as the page says them, in the locale the tests run in: Nov 26, 18:00
function day_of(at)
{
    return new Date(at).toLocaleDateString([], {month: 'short', day: 'numeric'});
}

function time_of(at)
{
    return new Date(at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
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

// A rate's top is rounded in the unit it is said in: 20MB/s where the decimal round said 19.1MB/s;
// its middle is said in its own unit, and a mebibyte is never 1024KB/s
test('a rate\'s top reads round, in the unit it is said in', async function () {
    const chart_scale_of = await module_of('chart_scale_of');
    assert.deepStrictEqual(chart_scale_of('rate', 20e6), {top: 20*MB, top_said: '20MB/s', half_said: '10MB/s'});
    assert.deepStrictEqual(chart_scale_of('rate', 5e6), {top: 5*MB, top_said: '5MB/s', half_said: '2.5MB/s'});
    assert.deepStrictEqual(chart_scale_of('rate', 900*1024), {top: MB, top_said: '1MB/s', half_said: '512KB/s'});
    assert.deepStrictEqual(chart_scale_of('rate', MB), {top: MB, top_said: '1MB/s', half_said: '512KB/s'}, 'a whole power stays itself');
    assert.deepStrictEqual(chart_scale_of('rate', 300), {top: 500, top_said: '500B/s', half_said: '250B/s'});
    assert.deepStrictEqual(chart_scale_of('rate', 1.5e9), {top: 2*1024*MB, top_said: '2GB/s', half_said: '1GB/s'});
    assert.deepStrictEqual(chart_scale_of('rate', 0), {top: 1024, top_said: '1KB/s', half_said: '512B/s'}, 'nothing moved');
});

// A share is out of 100; a count and a ping are rounded up to 1, 2 or 5 of their order
test('a share tops at 100%, a count and a ping at 1, 2 or 5 of their order', async function () {
    const chart_scale_of = await module_of('chart_scale_of');
    assert.deepStrictEqual(chart_scale_of('share', 40), {top: 100, top_said: '100%', half_said: '50%'});
    assert.deepStrictEqual(chart_scale_of('share', 140), {top: 100, top_said: '100%', half_said: '50%'}, 'past 100 is drawn at the edge');
    assert.deepStrictEqual(chart_scale_of('ms', 47), {top: 50, top_said: '50 ms', half_said: '25 ms'});
    assert.deepStrictEqual(chart_scale_of('ms', 1000), {top: 1000, top_said: '1000 ms', half_said: '500 ms'});
    assert.deepStrictEqual(chart_scale_of('ms', 0.3), {top: 0.5, top_said: '0.5 ms', half_said: '0.25 ms'}, 'a ping on a LAN');
    assert.deepStrictEqual(chart_scale_of('count', 281), {top: 500, top_said: '500', half_said: '250'});
    assert.deepStrictEqual(chart_scale_of('count', 3), {top: 5, top_said: '5', half_said: '2.5'});
    assert.deepStrictEqual(chart_scale_of('count', 0), {top: 1, top_said: '1', half_said: '0.5'});
});

// Round times between the ends, clear of them, as many as there is room for: 18:00, Nov 26 at
// midnight, 06:00 for the last 24 hours; one in the middle where there is room for one
test('a chart\'s round times are the clock\'s, as many as fit', async function () {
    const chart_times_of = await module_of('chart_times_of');
    const day = {range: '24h', from: NOW - DAY, to: NOW, away: false};
    const three = chart_times_of(day, 3, NOW).ticks;
    assert.deepStrictEqual(three.map(v => v.at), [Date.UTC(2026, 10, 25, 18), Date.UTC(2026, 10, 26), Date.UTC(2026, 10, 26, 6)]);
    assert.deepStrictEqual(three.map(v => v.said), [time_of(Date.UTC(2026, 10, 25, 18)), day_of(Date.UTC(2026, 10, 26)), time_of(Date.UTC(2026, 10, 26, 6))]);
    assert.deepStrictEqual(three.map(v => Number(v.share.toFixed(3))), [0.249, 0.499, 0.749]);
    assert.deepStrictEqual(chart_times_of(day, 1, NOW).ticks.map(v => v.said), [day_of(Date.UTC(2026, 10, 26))], 'room for one: midnight');

    const ten = chart_times_of({range: '10m', from: NOW - 10*MINUTE, to: NOW, away: false}, 4, NOW).ticks;
    assert.deepStrictEqual(ten.map(v => v.at), [54, 56, 58, 60].map(v => Date.UTC(2026, 10, 26, 11, v)), 'every other minute');
    const hour = chart_times_of({range: '1h', from: NOW - HOUR, to: NOW, away: false}, 4, NOW).ticks;
    assert.deepStrictEqual(hour.map(v => v.said), ['11:15', '11:30', '11:45'].map(v => time_of(Date.UTC(2026, 10, 26, 11, Number(v.slice(3))))), 'every quarter, 12:00 too near the end');

    const week = chart_times_of({range: '7d', from: NOW - 7*DAY, to: NOW, away: false}, 3, NOW).ticks;
    assert.deepStrictEqual(week.map(v => v.at), [Date.UTC(2026, 10, 22), Date.UTC(2026, 10, 24)], 'every other day');
    const month = chart_times_of({range: '30d', from: NOW - 30*DAY, to: NOW, away: false}, 4, NOW).ticks;
    assert.deepStrictEqual(month.map(v => new Date(v.at).getUTCDay()), [1, 1, 1, 1], 'weeks on Mondays');
    assert.deepStrictEqual(month.map(v => v.said), [2, 9, 16, 23].map(v => day_of(Date.UTC(2026, 10, v))));
});

// The start of the last 24 hours says its day, so a machine away since 08:50 reads from
// Nov 25 08:50 to 08:50, not from 08:50 to 08:50; an hour today says its time alone, an hour of
// another day its day too; a week, days alone
test('a chart\'s start says its day where it crosses one', async function () {
    const chart_times_of = await module_of('chart_times_of');
    const went = Date.UTC(2026, 10, 26, 8, 50);
    const away = chart_times_of({range: '24h', from: went - DAY, to: went, away: true}, 3, NOW);
    assert.strictEqual(away.start, `${day_of(went - DAY)} ${time_of(went - DAY)}`);
    assert.strictEqual(away.end, time_of(went));
    assert.notStrictEqual(away.start, away.end);
    assert.strictEqual(chart_times_of({range: '24h', from: NOW - DAY, to: NOW, away: false}, 3, NOW).end, 'now');

    const hour = chart_times_of({range: '1h', from: NOW - HOUR, to: NOW, away: false}, 3, NOW);
    assert.deepStrictEqual([hour.start, hour.end], [time_of(NOW - HOUR), 'now']);
    const old = Date.UTC(2026, 10, 24, 11, 2);
    const gone = chart_times_of({range: '1h', from: old - HOUR, to: old, away: true}, 3, NOW);
    assert.deepStrictEqual([gone.start, gone.end], [`${day_of(old - HOUR)} ${time_of(old - HOUR)}`, `${day_of(old)} ${time_of(old)}`], 'two days ago');

    const week = chart_times_of({range: '7d', from: NOW - 7*DAY, to: NOW, away: false}, 3, NOW);
    assert.deepStrictEqual([week.start, week.end], [day_of(NOW - 7*DAY), 'now']);
});

// History draws each chart against its scale: the top and the middle said on their lines, and
// as many round times under it as its width has room for
test('History says each chart\'s top and middle, and the times its width has room for', async function () {
    const remote_charts = await module_of('remote_charts');
    const points = [];
    for (let at = NOW - DAY; at < NOW; at += 30*MINUTE) {
        points.push({at, cpu: 0.3, mem: 2e9, mem_total: 8e9, disk: 1e11, disk_total: 1.6e11, disk_read: 1e5, disk_write: 2e5, net_in: 20e6, net_out: 4e6, tcp: 281, ping: 25});
    }
    const data = {range: '24h', from: NOW - DAY, to: NOW, step_ms: 30*MINUTE, points, away: false};
    const view = {name: 'vps1', phase: 'online', agent_version: '1.40.1', machine: {can: ['metrics']}};
    const history = vm_of(remote_charts, {view, charts: {range: '24h', data, error: null, old: false, loading: false}, plot_width: 417});
    const said = Object.fromEntries(history.plots.map(v => [v.key, `${v.half} of ${v.top}`]));
    assert.deepStrictEqual(said, {cpu: '50% of 100%', mem: '50% of 100%', disk: '50% of 100%', io: '100KB/s of 200KB/s', net: '10MB/s of 20MB/s', tcp: '250 of 500', ping: '25 ms of 50 ms'});
    assert.strictEqual(history.start, `${day_of(NOW - DAY)} ${time_of(NOW - DAY)}`);
    assert.strictEqual(history.end, 'now');
    assert.strictEqual(history.ticks.length, 3, 'a third of the page');
    history.plot_width = 330;
    assert.strictEqual(history.ticks.length, 3, 'a phone: three, those touching the ends give way on the page');
    history.plot_width = 150;
    assert.strictEqual(history.ticks.length, 1, 'room for one');
});
