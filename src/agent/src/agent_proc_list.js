const agent_shell = require('./agent_shell');
const argv_line = require('../../helpers/argv_line');
const fs = require('fs');
const timers = require('timers/promises');

// The columns ps is asked for, in the order it prints them. The last one is the command line
// itself, spaces and all, so it takes whatever is left of the line.
const RE_LINE = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/;
const RSS_BLOCK_BYTES = 1024;
// How long cpu use is measured over: what top shows is a short window like this, not the
// average over a process's whole life that ps prints
const CPU_WINDOW_MS = 500;
const CLOCK_TICKS_DEFAULT = 100;
const PS_ARGV = ['ps', '-eo', 'pid=,ppid=,user:32=,pcpu=,pmem=,rss=,etimes=,stat=,args='];

const clock = {ticks: null};

// Every process on this machine, not this agent's own: ps -e is the whole table, which is what
// a page showing a machine is for. The tree is left to whoever reads it — each process carries
// the pid of the one that started it, and that is all a tree needs.
//
// `cpu` is the share of one core each process used over the last half second, from the cpu
// time linux keeps for it in /proc; 100 is a whole core, so a process on several goes past
// it. Where there is no /proc it is what ps says, and `cpu_window_ms` is null to say so.
//
// `user:32` because the default width cuts a name at eight characters without saying so.
async function agent_proc_list()
{
    const before = cpu_ticks();
    if (before !== null) {
        await timers.setTimeout(CPU_WINDOW_MS);
    }
    const answer = await agent_shell(PS_ARGV);
    if (answer.ok === false) {
        throw new Error(`ps: ${answer.stderr}`);
    }
    const after = cpu_ticks();
    const measured = (before !== null) && (after !== null);
    const ticks_per_second = measured ? await clock_ticks() : CLOCK_TICKS_DEFAULT;
    const seconds = measured ? Number(after.at - before.at)/1e9 : 0;
    const items = [];
    for (const line of answer.stdout.split('\n')) {
        const found = RE_LINE.exec(line);
        if (found === null) {
            continue;
        }
        const pid = parseInt(found[1], 10);
        const ppid = parseInt(found[2], 10);
        // The ps that made this list is not something the machine is running
        if ((ppid === process.pid) && found[9].startsWith('ps ')) {
            continue;
        }
        let cpu = parseFloat(found[4]);
        if (measured) {
            const was = before.ticks.get(pid);
            const now = after.ticks.get(pid);
            cpu = ((was === undefined) || (now === undefined) || (seconds <= 0)) ? 0 : Math.max(0, now - was)/ticks_per_second/seconds*100;
        }
        items.push({
            pid,
            ppid,
            user: found[3],
            cpu: Math.round(cpu*10)/10,
            mem: parseFloat(found[5]),
            rss: parseInt(found[6], 10)*RSS_BLOCK_BYTES,
            // How long it has been running, which is the one thing about a process that a
            // reader can compare without knowing the machine's clock
            elapsed_ms: parseInt(found[7], 10)*1000,
            state: found[8],
            command: found[9],
        });
    }
    return {at: Date.now(), cpu_window_ms: measured ? Math.round(seconds*1000) : null, items, commands: [argv_line(PS_ARGV)]};
}

// The cpu time of every process, user and system, in clock ticks; null where there is no /proc
function cpu_ticks()
{
    let names;
    try {
        names = fs.readdirSync('/proc');
    }
    catch {
        return null;
    }
    const at = process.hrtime.bigint();
    const ticks = new Map();
    for (const name of names) {
        if (/^\d+$/.test(name) === false) {
            continue;
        }
        try {
            // The command name in brackets may hold spaces and brackets of its own: the fields
            // are counted from the last closing one. utime and stime are the 14th and 15th.
            const text = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
            const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
            ticks.set(parseInt(name, 10), parseInt(fields[11], 10) + parseInt(fields[12], 10));
        }
        catch {
            // It ended between the listing and the reading
        }
    }
    return (ticks.size === 0) ? null : {at, ticks};
}

// How many ticks a second of cpu time is: 100 nearly everywhere, and asked once
async function clock_ticks()
{
    if (clock.ticks === null) {
        const answer = await agent_shell(['getconf', 'CLK_TCK']);
        const value = parseInt(answer.stdout, 10);
        clock.ticks = (answer.ok && (value > 0)) ? value : CLOCK_TICKS_DEFAULT;
    }
    return clock.ticks;
}

module.exports = agent_proc_list;
