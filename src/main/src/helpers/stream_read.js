// One stream of lines as an answer: every line it has said, from the first one kept, then each
// new one as it is said, until its end. A reader that comes after the end reads it all at once.
function stream_read(stream, res)
{
    res.writeHead(200, {'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no'});
    if (stream.dropped > 0) {
        res.write(`${JSON.stringify({text: `… the first ${stream.dropped} lines are not kept`})}\n`);
    }
    for (const line of stream.lines) {
        res.write(line);
    }
    if (stream.ended_at !== null) {
        res.end();
        return;
    }
    stream.readers.add(res);
    res.on('close', function () {
        stream.readers.delete(res);
    });
}

module.exports = stream_read;
