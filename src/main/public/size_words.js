// A size as a card says it in a few words: "6.2 GB", "18 GB", "512 MB"
function size_words(bytes)
{
    const gb = bytes/(1024*1024*1024);
    return (gb >= 1) ? `${(gb >= 10) ? Math.round(gb) : gb.toFixed(1)} GB` : `${Math.round(bytes/(1024*1024))} MB`;
}

export default size_words;
