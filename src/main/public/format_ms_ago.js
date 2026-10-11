// The age of a thing, said in its one biggest unit: a file from years back does not need its
// minutes read out. format_ms is for the short ranges, where every part still matters.
// A date ahead of now — a machine's clock standing ahead, a file dated forward on purpose —
// is said as "in …" rather than clamped into the past.
function format_ms_ago(ms)
{
    if (ms < -500) {
        return `in ${age_text(-ms)}`;
    }
    return `${age_text(ms)} ago`;
}

function age_text(ms)
{
    const total = Math.max(0, Math.round(ms/1000));
    if (total < 60) {
        return `${total}s`;
    }
    if (total < 3600) {
        return `${Math.floor(total/60)}m`;
    }
    if (total < 86400) {
        return `${Math.floor(total/3600)}h`;
    }
    if (total < 86400*365) {
        return `${Math.floor(total/86400)}d`;
    }
    return `${Math.floor(total/86400/365)}y`;
}

export default format_ms_ago;
