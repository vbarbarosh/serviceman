const agent_bye = require('./agent_bye');
const child_process = require('child_process');

// A laptop that suspends says so first. systemd-logind tells everything on the machine that
// sleep is coming — that is what `PrepareForSleep true` is — and this listens for it, so the
// host learns the machine is going to sleep instead of watching it stop answering.
//
// It is a line reader over `gdbus monitor` rather than a dbus library: the agent is one file
// with nothing under it, and this is one long-lived process reading one kind of line. A
// machine without gdbus, or without logind, simply never says it is sleeping.
function agent_sleep_watch(say)
{
    let out;
    try {
        out = child_process.spawn('gdbus', [
            'monitor',
            '--system',
            '--dest', 'org.freedesktop.login1',
            '--object-path', '/org/freedesktop/login1',
        ], {stdio: ['ignore', 'pipe', 'ignore']});
    }
    catch {
        return null;
    }
    let rest = '';
    out.stdout.on('data', function (chunk) {
        rest += chunk.toString('utf8');
        const lines = rest.split('\n');
        rest = lines.pop();
        for (const line of lines) {
            if (/PrepareForSleep \(true,?\)/.test(line)) {
                say('suspending');
                agent_bye('suspending');
            }
        }
    });
    out.on('error', function () {
        // No gdbus on this machine; nothing here to do about it
    });
    // It must not hold the process open: the agent ends when the agent ends
    out.unref();
    return out;
}

module.exports = agent_sleep_watch;
