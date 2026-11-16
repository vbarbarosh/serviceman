const child_process = require('child_process');

// How many of the last calls are kept for the Tailscale page
const CALLS_KEPT = 50;

const calls = [];

// tailscale run as child_process.execFile runs it, `tailscale <args>`, and each call kept for the
// Tailscale page: when, what was asked, how long it took, and why it failed. What it printed is
// never kept: `tailscale cert` prints the certificate's key.
//
//     calls()   [{at, command, ms, error}], the newest first; error null for a call that went
function tailscale_run(args, options, done)
{
    const at = Date.now();
    child_process.execFile('tailscale', args, options, function (error, stdout, stderr) {
        calls.unshift({at, command: `tailscale ${args.join(' ')}`, ms: Date.now() - at, error: (error === null) ? null : reason_of(error, stderr)});
        calls.splice(CALLS_KEPT);
        done(error, stdout, stderr);
    });
}

// Why a call failed in tailscale's own words, its last line, or the error itself: not there,
// timed out
function reason_of(error, stderr)
{
    if (error.code === 'ENOENT') {
        return 'no tailscale here';
    }
    const said = String(stderr || '').trim().split('\n').pop();
    return (said === '') ? error.message : said;
}

tailscale_run.calls = function () {
    return calls.slice();
};

tailscale_run.reason_of = reason_of;

module.exports = tailscale_run;
