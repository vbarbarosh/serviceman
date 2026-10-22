const streams_of = require('./streams_of');

const KEEP_LINES = 500;

// One line an upgrade printed on that machine, kept for the page that asked for the upgrade.
// The whole run is here — apt says a few hundred lines and a person reading it wants all of
// them, not the last of them — and said in its stream as it comes, for the page reading it.
function apt_said(app, remote, text)
{
    const run = remote.state.apt;
    const stream = streams_of(app).get(run.stream);
    if (stream !== undefined) {
        stream.write({text});
    }
    run.lines.push(text);
    while (run.lines.length > KEEP_LINES) {
        run.lines.shift();
    }
}

module.exports = apt_said;
