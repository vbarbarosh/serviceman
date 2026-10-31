const agent_metrics_rounded = require('./agent_metrics_rounded');

// servermon's lines said as one point dated `at`: the rates and the cpu as their mean, the rest
// as the last of them says, and the ping as the mean of `pings`. The half-minute lines are made
// of thirty of them, the ten-minute chart of one each.
function agent_metrics_sample(rows, pings, at)
{
    const last = rows[rows.length - 1];
    return agent_metrics_rounded({
        at,
        cpu: mean(rows.map(v => (typeof v.cpu === 'number') ? v.cpu/100 : null)),
        load: last.load,
        mem: last.mem_used,
        mem_total: last.mem_total,
        disk: sum_of(last.mounts, 'used'),
        disk_total: sum_of(last.mounts, 'size'),
        disk_read: mean(rows.map(v => sum_of(v.disks, 'read'))),
        disk_write: mean(rows.map(v => sum_of(v.disks, 'write'))),
        net_in: mean(rows.map(v => sum_of(v.nets, 'in'))),
        net_out: mean(rows.map(v => sum_of(v.nets, 'out'))),
        tcp: ((last.tcp === null) || (typeof last.tcp !== 'object')) ? null : last.tcp.open,
        ping: mean(pings),
    });
}

// The items' values added up; null when none of them has one
function sum_of(items, key)
{
    if (Array.isArray(items) === false) {
        return null;
    }
    const values = items.map(v => v[key]).filter(v => (typeof v === 'number'));
    return (values.length === 0) ? null : values.reduce((a, b) => a + b, 0);
}

function mean(values)
{
    const found = values.filter(v => (typeof v === 'number'));
    return (found.length === 0) ? null : found.reduce((a, b) => a + b, 0)/found.length;
}

module.exports = agent_metrics_sample;
