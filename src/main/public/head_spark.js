// A head's small chart of one share over the last hour, as History's 1h has it: its line and the
// area under it in a box of SPARK_W by SPARK_H, 0 to 100 %, a gap where the machine measured
// nothing for more than two steps, the newest point to put a dot on, and the least and the most
// the hour saw, for its title. Null when the hour holds no point of it.
//
//     data    History's answer for 1h: {from, to, step_ms, points: [{at, …}]}
//     of      (point) -> the share in %, or null for a point that says nothing of it
//     ->      {line, area, last: {x, y}, least, most}
const SPARK_W = 120;
const SPARK_H = 30;

function head_spark(data, of)
{
    if ((data === null) || (data === undefined) || (Array.isArray(data.points) === false) || (data.to <= data.from)) {
        return null;
    }
    // The points drawn, in runs the gaps cut apart
    const runs = [];
    let prev_at = null;
    let least = null;
    let most = null;
    for (const point of data.points) {
        const value = of(point);
        if ((value === null) || (Number.isFinite(value) === false)) {
            prev_at = null;
            continue;
        }
        if ((prev_at === null) || (point.at - prev_at > 2.5*data.step_ms)) {
            runs.push([]);
        }
        const share = Math.min(100, Math.max(0, value));
        const x = Number(((point.at + data.step_ms/2 - data.from)/(data.to - data.from)*SPARK_W).toFixed(1));
        const y = Number((SPARK_H - share/100*SPARK_H).toFixed(1));
        runs[runs.length - 1].push({x, y});
        prev_at = point.at;
        least = (least === null) ? value : Math.min(least, value);
        most = (most === null) ? value : Math.max(most, value);
    }
    if (runs.length === 0) {
        return null;
    }
    const newest = runs[runs.length - 1];
    return {line: runs.map(spark_line).join(''), area: runs.map(spark_area).join(''), last: newest[newest.length - 1], least, most};
}

// One run as a line; a run of one point is a dash a tenth of a unit long, so it shows
function spark_line(run)
{
    return `M${run[0].x} ${run[0].y}h0.1${run.slice(1).map(v => `L${v.x} ${v.y}`).join('')}`;
}

// The area under one run, down to the box's bottom
function spark_area(run)
{
    return `M${run[0].x} ${SPARK_H}${run.map(v => `L${v.x} ${v.y}`).join('')}L${run[run.length - 1].x} ${SPARK_H}Z`;
}

head_spark.W = SPARK_W;
head_spark.H = SPARK_H;

export default head_spark;
