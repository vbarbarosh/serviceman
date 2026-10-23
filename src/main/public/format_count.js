// A count as it reads at a glance: as it is below ten thousand, then in thousands and millions
function format_count(count)
{
    if (count < 10000) {
        return String(count);
    }
    if (count < 1000000) {
        return `${Math.round(count/1000)}K`;
    }
    return `${(count/1000000).toFixed(1)}M`;
}

export default format_count;
