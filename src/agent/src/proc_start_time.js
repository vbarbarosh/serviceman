const fs = require('fs');

// When a process started, in clock ticks since boot, or null when there is no such process. A
// pid is a number the kernel hands out again; the pid and this together name one process.
function proc_start_time(pid)
{
    let text;
    try {
        text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    }
    catch {
        return null;
    }
    // The name in parentheses may hold spaces and parentheses of its own: the fields are
    // counted from after the last one. Start time is the 22nd field, the 20th after the name.
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return ((fields[19] === undefined) ? null : fields[19]);
}

module.exports = proc_start_time;
