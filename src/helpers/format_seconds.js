// How long something took, the way the house writes it: seconds, to the millisecond.
//
//     0.006s   4.512s   30.001s
function format_seconds(ms)
{
    return `${(ms/1000).toFixed(3)}s`;
}

module.exports = format_seconds;
