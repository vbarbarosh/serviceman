import CHARTS_RANGES from './charts_ranges.js';
import chart_newest_of from './chart_newest_of.js';
import clock_of from './clock_of.js';
import head_spark from './head_spark.js';
import machine_shares from './machine_shares.js';
import share_of from './share_of.js';

// The three a head says and charts, each a share in % of a point of the machine's numbers, as
// History's CPU, Memory and All disks read the same point
const CHARTED = {
    CPU: v => share_of(v.cpu, 1),
    Memory: v => share_of(v.mem, v.mem_total),
    Disk: v => share_of(v.disk, v.disk_total),
};

// How near to when a machine went the charts kept for it must end to be drawn as its last: they
// are kept as last read, which may be days before
const AWAY_KEPT_MS = 5*60000;

// A chart with nothing in it yet: the room of one, its scale's lines drawn, so the head does not
// jump when its points come
const SPARK_EMPTY = {line: '', area: '', last: null, least: null, most: null};

// A machine's CPU, Memory and Disk as its head's facts, from the one reading its head and History
// share (remote_page reads it once a tick): each the newest point of that reading, the number
// History's chart ends on, with the reading's range as a small chart under it; Memory said out
// of how much, Disk as all its disks together, as History's All disks. A value the newest points
// do not say, or say from too long ago, is —. Away, the reading before it went, dim, when
// serviceman read it then.
// Until the first reading lands, and where there is none (an agent before charts, a machine away
// that was not read before it went), the numbers its agent last said, each with its bar; away,
// dim, with no bar.
//
//     view      a remote of the status: {phase, left_at, machine: {cpu_busy, mem, disk, disks}}
//     charts    the reading: {range, since, until, step_ms, points, away}; null for none; undefined
//               while the first is read, a chart's room left empty so the head does not jump
//     ->        [{label: 'Memory', value: '35%', small: 'of 8 GB', share: 0.35, dim: false,
//                 title: '…', spark: null or head_spark's}, …]
function remote_facts(view, charts)
{
    const machine = view.machine;
    if ((machine === null) || (machine === undefined)) {
        return [];
    }
    if (charts === undefined) {
        return said_facts(view).map(v => Object.assign(v, {spark: SPARK_EMPTY}));
    }
    if (charts_drawn(view, charts) === false) {
        return said_facts(view).map(v => Object.assign(v, {spark: null}));
    }
    return Object.keys(CHARTED).map(v => read_fact(view, charts, v));
}

// One fact from the reading: its newest point said, and the range charted under it
function read_fact(view, charts, label)
{
    const of = CHARTED[label];
    const point = chart_newest_of(charts, v => (of(v) !== null));
    const value = (point === null) ? null : of(point);
    const dim = (view.phase !== 'online');
    const spark = head_spark(charts, of);
    const range = CHARTS_RANGES.find(v => v.value === charts.range);
    const said = (range === undefined) ? charts.range : range.said;
    const when = dim ? `the ${said} before ${clock_of(charts.until)}` : `the last ${said}`;
    const span = (spark === null) ? 'nothing measured' : span_said(spark);
    return {
        label,
        value: (value === null) ? '—' : `${Math.round(value)}%`,
        small: small_of(label, point, dim),
        share: (value === null) ? null : value/100,
        dim,
        title: `${label}${(label === 'Disk') ? ', all its disks together' : ''}, ${when}: ${span} (its lines at 100% and 50%)`,
        spark: (spark === null) ? SPARK_EMPTY : spark,
    };
}

// What a fact says beside its number: out of how much, and away, when it was measured
function small_of(label, point, dim)
{
    if (point === null) {
        return '';
    }
    if (label === 'CPU') {
        return dim ? `at ${clock_of(point.at)}` : '';
    }
    const part = (label === 'Memory') ? point.mem : point.disk;
    const whole = (label === 'Memory') ? point.mem_total : point.disk_total;
    return (dim && (label === 'Memory')) ? part_of(part, whole) : `of ${size_short(whole)}`;
}

// The least and the most of a chart, rounded as its number is: 23%, or 4 to 97%
function span_said(spark)
{
    const least = Math.round(spark.least);
    const most = Math.round(spark.most);
    return (least === most) ? `${most}%` : `${least} to ${most}%`;
}

// Whether a reading is drawn: that of a machine away only when it ends where it went
function charts_drawn(view, charts)
{
    if (charts === null) {
        return false;
    }
    if (charts.away !== true) {
        return true;
    }
    return (typeof view.left_at === 'number') && (view.left_at - charts.until <= AWAY_KEPT_MS);
}

// The numbers the machine's agent last said in the status: online, each with its bar, Memory and
// Disk out of how much; away, the last it said, dim, CPU with when it said it. Disk is all its
// disks together where the agent counts them, as the reading says it.
function said_facts(view)
{
    const machine = view.machine;
    const online = (view.phase === 'online');
    const shares = machine_shares(machine);
    const mem = machine.mem;
    const disks = ((machine.disks === null) || (machine.disks === undefined) || (machine.disks.total > 0) === false) ? null : machine.disks;
    const disk_share = (disks === null) ? shares.disk : disks.used/disks.total;
    const disk_total = (disks === null) ? machine.disk.total : disks.total;
    const at = ((online === false) && (view.left_at !== null)) ? `at ${clock_of(view.left_at)}` : '';
    const title = online ? 'the whole machine, now' : 'the last it said, before it went away';
    return [
        {label: 'CPU', value: percent(shares.cpu), small: online ? '' : at, share: shares.cpu, dim: (online === false), title},
        {label: 'Memory', value: percent(shares.memory), small: (mem.total > 0) ? (online ? `of ${size_short(mem.total)}` : part_of(mem.total - mem.free, mem.total)) : '', share: shares.memory, dim: (online === false), title},
        {label: 'Disk', value: percent(disk_share), small: (disk_total > 0) ? `of ${size_short(disk_total)}` : '', share: disk_share, dim: (online === false), title},
    ];
}

// A share as a head says it, — for one not said
function percent(share)
{
    return (share === null) ? '—' : `${Math.round(share*100)}%`;
}

// A size in a few characters: "2 TB", "160 GB", "8 GB", "6.2 GB", "512 MB"
function size_short(bytes)
{
    const gb = bytes/(1024*1024*1024);
    if (gb >= 1024) {
        return `${Number((gb/1024).toFixed((gb >= 10240) ? 0 : 1))} TB`;
    }
    if (gb >= 1) {
        return `${Number(gb.toFixed((gb >= 10) ? 0 : 1))} GB`;
    }
    return `${Math.round(bytes/(1024*1024))} MB`;
}

// A part of a whole in one unit where both share it: "21 of 64 GB", "512 MB of 8 GB"
function part_of(part, whole)
{
    const a = size_short(part);
    const b = size_short(whole);
    const unit = / [A-Z]+$/;
    return (a.match(unit)[0] === b.match(unit)[0]) ? `${a.replace(unit, '')} of ${b}` : `${a} of ${b}`;
}

export default remote_facts;
