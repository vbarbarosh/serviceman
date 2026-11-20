// A count as a head says it in a few characters: 4100 is "4.1k", 2300000 is "2.3M"
function count_words(n)
{
    if (n >= 1000000) {
        return `${(n/1000000).toFixed(1)}M`;
    }
    if (n >= 1000) {
        return `${(n/1000).toFixed(1)}k`;
    }
    return String(n);
}

export default count_words;
