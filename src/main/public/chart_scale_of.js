// The steps a scale's top is rounded up to, within one order: a rate's order is 1024, the
// last step its next unit's 1
const STEPS_DECIMAL = [1, 2, 5, 10];
const STEPS_BINARY = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1024];
const UNITS_BINARY = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

// A chart's scale: its top, rounded up so the line never touches the edge, and the top and the
// middle as the chart says them on their lines. A rate is rounded in the unit it is said in, so
// its top reads round: 20MB/s, never 19.1MB/s.
//
//     unit     how its values are said: 'share' (0 to 100, a % of a whole), 'rate' (bytes a
//              second), 'count', 'ms'
//     most     the highest value it draws, in that unit; 0 or less for none
//     ->       {top: 20971520, top_said: '20MB/s', half_said: '10MB/s'}
function chart_scale_of(unit, most)
{
    const top = top_of(unit, most);
    return {top, top_said: format_level(unit, top), half_said: format_level(unit, top/2)};
}

function top_of(unit, most)
{
    if (unit === 'share') {
        return 100;
    }
    if (unit === 'rate') {
        if (most <= 0) {
            return 1024;
        }
        const order = 1024**power_of(most, 1024);
        return STEPS_BINARY.find(v => v*order >= most)*order;
    }
    if (most <= 0) {
        return 1;
    }
    const order = 10**power_of(most, 10);
    return STEPS_DECIMAL.find(v => v*order >= most)*order;
}

// The power of a base a value is of: 2 for 3e6 in 1024s (MB), 3 for 1000 in tens; counted, not
// taken from logarithms, which miss a whole power by a hair (log 1048576 / log 1024 is not 2)
function power_of(value, base)
{
    let out = 0;
    while (base**(out + 1) <= value) {
        out += 1;
    }
    while ((out > -12) && (base**out > value)) {
        out -= 1;
    }
    return out;
}

// A value of the scale: 100%, 512KB/s, 2.5MB/s, 250, 25 ms, 0.25 ms
function format_level(unit, value)
{
    if (unit === 'share') {
        return `${number_round(value)}%`;
    }
    if (unit === 'rate') {
        const power = Math.min(UNITS_BINARY.length - 1, Math.max(0, power_of(value, 1024)));
        return `${number_round(value/1024**power)}${UNITS_BINARY[power]}/s`;
    }
    if (unit === 'ms') {
        return `${number_round(value)} ms`;
    }
    return String(number_round(value));
}

// A tenth at most, a hundredth below 1: a LAN's ping is a fraction of a millisecond
function number_round(value)
{
    return Number(value.toFixed((value < 1) ? 2 : 1));
}

export default chart_scale_of;
