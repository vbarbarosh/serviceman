const agent_metrics_rounded = require('./agent_metrics_rounded');

// Many samples said as one, dated `at`: each number the mean of the samples that had it, and
// null where none did. A number nobody had is not a zero.
function agent_metrics_average(rows, at)
{
    const means = {at};
    const keys = new Set();
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            keys.add(key);
        }
    }
    keys.delete('at');
    for (const key of keys) {
        let sum = 0;
        let count = 0;
        for (const row of rows) {
            if (typeof row[key] === 'number') {
                sum += row[key];
                count++;
            }
        }
        means[key] = ((count === 0) ? null : sum/count);
    }
    return agent_metrics_rounded(means);
}

module.exports = agent_metrics_average;
