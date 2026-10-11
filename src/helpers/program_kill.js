const timers = require('timers/promises');

// How long a program is given to stop by itself before it is made to, and how often it is
// looked at while it takes its time
const GRACE_MS = 5000;
const LOOK_EVERY_MS = 50;

// Stops a program and everything it started, and does not come back until nothing of it is
// left. A shell line is a chain — `bash` → `npm` → `sh` → the server — and neither bash nor
// npm passes a signal on, so the one process serviceman started is never the one that matters.
// That is why the signal goes to the group, and why the wait is for the group as well: the
// first process of it dies at once, and waiting for that one would call the service stopped
// while the server under it still held the port.
//
// The answer says what it took, because a program that needed the second signal is a program
// with something wrong in the middle of it — see notes/signals-through-a-process-chain.md.
async function program_kill(pid, grace_ms)
{
    if (alive(pid) === false) {
        return {gone: true, killed: false, waited_ms: 0};
    }
    const time0 = Date.now();
    const deadline = time0 + ((grace_ms === undefined) ? GRACE_MS : grace_ms);
    signal(pid, 'SIGTERM');
    while (alive(pid) && (Date.now() < deadline)) {
        await timers.setTimeout(LOOK_EVERY_MS);
    }
    if (alive(pid) === false) {
        return {gone: true, killed: false, waited_ms: Date.now() - time0};
    }
    signal(pid, 'SIGKILL');
    // Nothing survives a SIGKILL, but the kernel takes its own moment over it, and saying it is
    // gone before it is would be the same lie in a smaller size
    const dead_by = Date.now() + GRACE_MS;
    while (alive(pid) && (Date.now() < dead_by)) {
        await timers.setTimeout(LOOK_EVERY_MS);
    }
    return {gone: alive(pid) === false, killed: true, waited_ms: Date.now() - time0};
}

// Whether anything of the group is left. Signal 0 asks without touching: it succeeds while at
// least one process of the group is there, and a group nobody may signal is still a group that
// exists — that is what the permission error means, and it is not `gone`.
function alive(pid)
{
    try {
        process.kill(-pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}

// The group, and the process itself when it turned out not to lead one
function signal(pid, name)
{
    try {
        process.kill(-pid, name);
    }
    catch {
        try {
            process.kill(pid, name);
        }
        catch {
            // It went between the looking and the signalling, which is the outcome anyway
        }
    }
}

program_kill.GRACE_MS = GRACE_MS;

module.exports = program_kill;
