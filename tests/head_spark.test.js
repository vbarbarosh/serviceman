const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
const MINUTE = 60000;

async function module_of(name)
{
    return (await import(path.join(PUBLIC, `${name}.js`))).default;
}

// History's answer for 1h, a point a minute; skip: the minutes the machine did not measure
function hour_of(cpu_of, skip)
{
    const since = Date.UTC(2026, 10, 20, 19, 0);
    const points = [];
    for (let i = 0; i < 60; ++i) {
        if (skip.includes(i) === false) {
            points.push({at: since + i*MINUTE, cpu: cpu_of(i), mem: 2e9, mem_total: 8e9, disk: 112e9, disk_total: 160e9});
        }
    }
    return {range: '1h', since, until: since + 60*MINUTE, step_ms: MINUTE, points};
}

// The line starts again after minutes not measured, as History's does, and the area closes
// under each run
test('a chart of the hour breaks where the machine did not measure', async function () {
    const head_spark = await module_of('head_spark');
    const spark = head_spark(hour_of(() => 0.5, [41, 42, 43, 44]), v => v.cpu*100);
    assert.strictEqual(spark.line.split('M').length - 1, 2, 'two runs');
    assert.strictEqual(spark.area.split('Z').length - 1, 2, 'two areas');
    assert.deepStrictEqual([spark.least, spark.most], [50, 50]);
    assert.strictEqual(spark.last.x, 119);
    assert.strictEqual(spark.last.y, 15);
});

// The scale is 0 to 100% whatever the numbers: a share past it is drawn at its edge, a point
// with no number is a gap
test('a chart\'s scale is fixed at 0 to 100%', async function () {
    const head_spark = await module_of('head_spark');
    const spark = head_spark(hour_of(v => (v === 59) ? 1.4 : ((v === 10) ? null : 0), []), v => (v.cpu === null) ? null : v.cpu*100);
    assert.strictEqual(spark.last.y, 0, 'over 100% at the top');
    assert.strictEqual(spark.most, 140, 'the title says the number as measured');
    assert.strictEqual(spark.line.split('M').length - 1, 2, 'the point with no number breaks the line');
});

// No hour, no points or an empty range: no chart, and the head keeps its bar
test('nothing to chart draws no chart', async function () {
    const head_spark = await module_of('head_spark');
    assert.strictEqual(head_spark(null, v => v.cpu), null);
    assert.strictEqual(head_spark({since: 0, until: 0, step_ms: MINUTE, points: []}, v => v.cpu), null);
    assert.strictEqual(head_spark(hour_of(() => null, []), v => v.cpu), null);
});

// The head says and charts CPU, Memory and Disk from the same points History charts them from:
// its number is the newest point, never the status's own (23% here), and its title says what the
// chart covers and its dashed lines
test('a machine\'s head says its newest point and charts its range, titled with its span', async function () {
    const remote_facts = await module_of('remote_facts');
    const view = {phase: 'online', machine: {cpu_busy: 0.23, mem: {used: 2e9, total: 8e9}, disk: {used: 112e9, total: 160e9}}};
    const facts = remote_facts(view, hour_of(v => v/100, []));
    assert.deepStrictEqual(facts.map(v => v.label), ['CPU', 'Memory', 'Disk']);
    assert.deepStrictEqual(facts.map(v => v.value), ['59%', '25%', '70%'], 'the newest point\'s, as History\'s line ends');
    assert.strictEqual(facts[0].title, 'CPU, the last hour: 0 to 59% (its lines at 100% and 50%)');
    assert.strictEqual(facts[1].title, 'Memory, the last hour: 25% (its lines at 100% and 50%)');
    assert.strictEqual(facts[2].title, 'Disk, all its disks together, the last hour: 70% (its lines at 100% and 50%)');
    assert.deepStrictEqual(remote_facts(view, null).map(v => v.spark), [null, null, null], 'no hour, the bars');
    assert.deepStrictEqual(remote_facts(view, undefined).map(v => v.spark.line), ['', '', ''], 'while it is read, an empty chart');
});

// Away, the hour kept is the last one read: drawn grey when it ends where the machine went, and
// not at all when it was read long before, which it would be taken for its last
test('an away machine charts the hour before it went, never an older one', async function () {
    const remote_facts = await module_of('remote_facts');
    const clock_of = await module_of('clock_of');
    const hour = Object.assign(hour_of(() => 0.04, []), {away: true});
    const view = {phase: 'away', left_at: hour.until + 40000, machine: {cpu_busy: 0.04, mem: {used: 2e9, total: 8e9}, disk: {used: 112e9, total: 160e9}}};
    const facts = remote_facts(view, hour);
    assert.strictEqual(facts[0].title, `CPU, the hour before ${clock_of(hour.until)}: 4% (its lines at 100% and 50%)`);
    assert.ok(facts.every(v => v.dim && (v.spark !== null)), 'grey charts');
    const later = Object.assign({}, view, {left_at: hour.until + 3*86400000});
    assert.deepStrictEqual(remote_facts(later, hour).map(v => v.spark), [null, null, null], 'an hour from days before is not drawn');
});
