// The range a machine's charts are read for: the one picked, but the hour in place of the ten
// minutes where its agent is from before them (no metrics_live, before 1.32)
//
//     view      a remote of the status: {machine: {can: ['metrics', 'metrics_live', …]}}
//     picked    the range picked: '10m', '1h', '24h', '7d', '30d'
//     ->        '1h'
function charts_range_of(view, picked)
{
    const machine = view.machine;
    const live = (machine !== null) && (machine !== undefined) && Array.isArray(machine.can) && machine.can.includes('metrics_live');
    return ((picked === '10m') && (live === false)) ? '1h' : picked;
}

export default charts_range_of;
