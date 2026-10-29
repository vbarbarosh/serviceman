// The most files said of one link; a machine sent a folder file by file has many at once
const MOST = 3;

// The files a machine's link carries now: what a call to it waits behind, since every frame
// rides the one link in turn. {count, files}, files the MOST with the most bytes, each {way,
// name, bytes, taken, still_ms}: way 'to' or 'from' the machine; bytes sent to it, or got from
// it, so far; taken, of a file going to it, how much of it the machine said it wrote, null of
// one coming from it; still_ms how long since its bytes last moved, since it opened when they
// never did. A file whose `taken` stands while calls wait is one whose link carries nothing;
// one whose `taken` grows is a link that is full.
function link_carrying(state, now)
{
    const files = [];
    for (const id of Object.keys(state.streams)) {
        const stream = state.streams[id];
        if ((stream.carries === null) || (stream.carries === undefined)) {
            continue;
        }
        const to = (stream.carries.way === 'to');
        const moved_at = to ? stream.taken_at : stream.got_at;
        files.push({
            way: stream.carries.way,
            name: stream.carries.name,
            bytes: to ? stream.sent : stream.got,
            taken: to ? stream.taken : null,
            still_ms: now - ((moved_at === null) ? stream.opened_at : moved_at),
        });
    }
    return {count: files.length, files: files.sort((a, b) => b.bytes - a.bytes).slice(0, MOST)};
}

// The same in a log line's words, of the file with the most bytes: {} when there is none
link_carrying.words = function (carrying) {
    if (carrying.count === 0) {
        return {};
    }
    const first = carrying.files[0];
    return Object.assign(
        {carrying: carrying.count, file: first.name, way: first.way},
        (first.way === 'to') ? {sent: first.bytes, taken: first.taken} : {got: first.bytes},
        {still: `${Math.round(first.still_ms/1000)}s`}
    );
};

module.exports = link_carrying;
