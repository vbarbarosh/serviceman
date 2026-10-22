const crypto = require('crypto');
const streams_of = require('./streams_of');

// How long a stream is kept once it has ended, for a page that reloads to read how it ended
const ENDED_KEEP_MS = 10*60*1000;
// How long a stream that goes both ways waits to be joined
const JOIN_WITHIN_MS = 60*1000;
// The lines kept of one stream; the oldest go first, and a reader is told how many went
const KEEP_LINES = 5000;

// A stream a command answers with, read at /api/v1/streams/<id> (stream_read). One of lines is
// what a long command says as it goes, one JSON object a line, kept so a page that closes or
// reloads reads it again from the start and follows the rest. One that goes both ways is a
// terminal, joined once over a WebSocket at the same address, within a minute. Streams are
// kept in memory: a restart of serviceman ends them.
//
//     meta = {title, base, command, item, token, join}
//     base    the module's base it is of: a page finds its own by it
//     token   the id of the token that asked, or null for the owner: only that one reads it
//     join    for one that goes both ways: {remote, term}, what is joined
//
// The stream: write(value) says one line, end(value) says the last one; for one that goes
// both ways, take() hands its join over once and forgets it.
function stream_open(app, meta)
{
    const streams = streams_of(app);
    const id = `s_${crypto.randomBytes(12).toString('hex')}`;
    const out = {
        id,
        url: `/api/v1/streams/${id}`,
        kind: (meta.join === undefined) ? 'lines' : 'both',
        title: meta.title,
        base: meta.base,
        command: (meta.command === undefined) ? null : meta.command,
        item: (meta.item === undefined) ? null : meta.item,
        token: (meta.token === undefined) ? null : meta.token,
        started_at: Date.now(),
        ended_at: null,
        state: 'running',
        lines: [],
        dropped: 0,
        readers: new Set(),
        write: function (value) {
            if (out.ended_at !== null) {
                return;
            }
            const line = `${JSON.stringify(value)}\n`;
            out.lines.push(line);
            if (out.lines.length > KEEP_LINES) {
                out.lines.shift();
                out.dropped++;
            }
            for (const res of out.readers) {
                res.write(line);
            }
        },
        end: function (value) {
            if (out.ended_at !== null) {
                return;
            }
            out.write(value);
            out.ended_at = Date.now();
            out.state = (typeof value.end === 'string') ? value.end : 'done';
            for (const res of out.readers) {
                res.end();
            }
            out.readers.clear();
            forget_after(streams, id, ENDED_KEEP_MS);
        },
        take: function () {
            const join = meta.join;
            streams.delete(id);
            return join;
        },
    };
    streams.set(id, out);
    if (out.kind === 'both') {
        forget_after(streams, id, JOIN_WITHIN_MS);
    }
    return out;
}

function forget_after(streams, id, ms)
{
    setTimeout(function () {
        streams.delete(id);
    }, ms).unref();
}

module.exports = stream_open;
