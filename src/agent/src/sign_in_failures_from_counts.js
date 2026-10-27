// How many sign-ins were refused, from how many addresses, and the five that tried most, most
// first: from a count by address, where '' counts what came from no address that was read
//
//     -> {hours, count, addresses, top: [{address, count}]}
function sign_in_failures_from_counts(counts, hours)
{
    let count = 0;
    for (const value of counts.values()) {
        count += value;
    }
    const top = Array.from(counts).filter(v => v[0] !== '').map(v => ({address: v[0], count: v[1]}));
    top.sort((a, b) => (b.count - a.count) || a.address.localeCompare(b.address));
    return {hours, count, addresses: counts.size - (counts.has('') ? 1 : 0), top: top.slice(0, 5)};
}

module.exports = sign_in_failures_from_counts;
