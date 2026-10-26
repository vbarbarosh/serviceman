// How many bytes a stream inside a link may have on its way, not yet read at the far end.
// A stream carries at most its window each round trip: 256 KB on a link of 100 ms is 2.5 MB/s
// whatever the link could do. A stream of a file's bytes (one written or read here, a part of
// one, a tar of many) takes a window of 4 MB, and waits for the link besides, so its bytes
// never queue up ahead of a keystroke on the same link; every other stream keeps 256 KB.
const WINDOW_BYTES = 256*1024;
const FILE_WINDOW_BYTES = 4*1024*1024;

// The kinds of target whose stream is a file's bytes
const FILE_KINDS = ['file', 'part', 'tar_put', 'read', 'tar'];

function tunnel_window(target)
{
    const kinds = ((target === null) || (typeof target !== 'object')) ? [] : Object.keys(target);
    return kinds.some(v => FILE_KINDS.includes(v)) ? FILE_WINDOW_BYTES : WINDOW_BYTES;
}

tunnel_window.WINDOW_BYTES = WINDOW_BYTES;
tunnel_window.FILE_WINDOW_BYTES = FILE_WINDOW_BYTES;

module.exports = tunnel_window;
