// 95000 -> '1m 35s'; used by the control page and the waiting page
function format_duration_ms(ms)
{
    const total = Math.max(0, Math.round(ms/1000));
    const days = Math.floor(total/86400);
    const hours = Math.floor(total % 86400/3600);
    const minutes = Math.floor(total % 3600/60);
    const seconds = total % 60;
    const items = [];
    if (days > 0) {
        items.push(`${days}d`);
    }
    if (hours > 0) {
        items.push(`${hours}h`);
    }
    if (minutes > 0) {
        items.push(`${minutes}m`);
    }
    if (items.length < 2) {
        items.push(`${seconds}s`);
    }
    return items.join(' ');
}

module.exports = format_duration_ms;
