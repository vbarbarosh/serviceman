const KEEP_LINES = 500;

// One line an upgrade printed on that machine, kept for the page that asked for the upgrade.
// The whole run is here — apt says a few hundred lines and a person reading it wants all of
// them, not the last of them.
function apt_said(remote, text)
{
    const run = remote.state.apt;
    run.lines.push(text);
    while (run.lines.length > KEEP_LINES) {
        run.lines.shift();
    }
}

module.exports = apt_said;
