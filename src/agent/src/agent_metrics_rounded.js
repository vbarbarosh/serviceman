// Numbers as short as they still mean the same: a share to a tenth of a percent, the rest whole
function agent_metrics_rounded(sample)
{
    const out = {};
    for (const key of Object.keys(sample)) {
        const value = sample[key];
        if (typeof value !== 'number') {
            out[key] = value;
        }
        else if ((key === 'cpu') || (key === 'load')) {
            out[key] = Math.round(value*1000)/1000;
        }
        else {
            out[key] = Math.round(value);
        }
    }
    return out;
}

module.exports = agent_metrics_rounded;
