const agent_metrics_dir = require('./agent_metrics_dir');
const agent_say = require('./agent_say');
const agent_servermon_dir = require('./agent_servermon_dir');
const agent_uptime_state = require('./agent_uptime_state');
const file_write_synced = require('./file_write_synced');
const fs = require('fs');
const path = require('path');

// servermon writes a line a second: a longer gap than this is a stretch the machine was down
const GAP_MS = 10*1000;
// A day file is read a megabyte at a time, the agent's other work going on between them
const CHUNK_BYTES = 1024*1024;
// /proc/stat's btime moves a second when the clock is set: a reboot moves it more than this
const BOOT_MOVES_S = 60;
const KEEP_MS = 90*24*60*60*1000;
// The start of a line: its time, then the boot time a servermon from agent 1.22 on writes
const RE_LINE = /^\{"time":"([^"]+)"(?:,"boot":(\d+))?/;

const state = {running: null, failing: false};

// Counts the lines servermon wrote since the last count into agent_uptime_state, and writes it
// to uptime.json. Every byte is read once: a finished day when it is first met, today from where
// the last count stopped, and only the time and boot at the start of each line. A count asked
// while one runs is that one.
function agent_uptime_count(group)
{
    if (state.running === null) {
        state.running = count_run(group).finally(function () {
            state.running = null;
        });
    }
    return state.running;
}

async function count_run(group)
{
    const dir = agent_servermon_dir();
    if (dir === null) {
        return;
    }
    try {
        await count(dir);
        file_write_synced(path.join(agent_metrics_dir(), 'uptime.json'), JSON.stringify(agent_uptime_state));
        if (state.failing) {
            state.failing = false;
            agent_say(group, 'agent_uptime_ok', {});
        }
    }
    catch (error) {
        // Said once, not every minute: a full disk would fill the log as well
        if (state.failing === false) {
            state.failing = true;
            agent_say(group, 'agent_uptime_error', {reason: error.message});
        }
    }
}

// Every day file from the one counted last on, oldest first
async function count(dir)
{
    if (fs.existsSync(dir) === false) {
        return;
    }
    const names = fs.readdirSync(dir).filter(v => /^\d{8}\.jsonl$/.test(v)).sort();
    for (const name of names) {
        if ((agent_uptime_state.file !== null) && (name < agent_uptime_state.file)) {
            continue;
        }
        if (name !== agent_uptime_state.file) {
            agent_uptime_state.file = name;
            agent_uptime_state.offset = 0;
        }
        await file_count(path.join(dir, name));
    }
    const oldest = Date.now() - KEEP_MS;
    agent_uptime_state.down = agent_uptime_state.down.filter(v => v.to >= oldest);
}

// The whole lines from the offset on; a last line still being written waits for the next count
async function file_count(file)
{
    const handle = await fs.promises.open(file, 'r');
    try {
        const size = (await handle.stat()).size;
        const buffer = Buffer.alloc(CHUNK_BYTES);
        let carry = '';
        while ((agent_uptime_state.offset + carry.length) < size) {
            const {bytesRead} = await handle.read(buffer, 0, CHUNK_BYTES, agent_uptime_state.offset + carry.length);
            if (bytesRead === 0) {
                break;
            }
            // latin1 keeps a character to a byte, so the offset is the text's length: the times are
            // ASCII, and a name in another script further along the line is never read
            const text = carry + buffer.toString('latin1', 0, bytesRead);
            const end = text.lastIndexOf('\n');
            if (end === -1) {
                carry = text;
                continue;
            }
            for (const line of text.slice(0, end).split('\n')) {
                line_count(line);
            }
            agent_uptime_state.offset += end + 1;
            carry = text.slice(end + 1);
        }
    }
    finally {
        await handle.close();
    }
}

function line_count(line)
{
    const found = RE_LINE.exec(line);
    if (found === null) {
        return;
    }
    const at = Date.parse(found[1]);
    if (Number.isNaN(at)) {
        return;
    }
    const boot = (found[2] === undefined) ? null : Number(found[2]);
    const last_at = agent_uptime_state.last_at;
    const last_boot = agent_uptime_state.last_boot;
    if (agent_uptime_state.first_at === null) {
        agent_uptime_state.first_at = at;
    }
    else if ((at - last_at) > GAP_MS) {
        agent_uptime_state.down.push({from: last_at + 1000, to: at, why: why_of(last_boot, boot)});
    }
    agent_uptime_state.last_at = at;
    agent_uptime_state.last_boot = boot;
}

function why_of(boot_before, boot_after)
{
    if ((boot_before === null) || (boot_after === null)) {
        return null;
    }
    return (Math.abs(boot_after - boot_before) > BOOT_MOVES_S) ? 'reboot' : 'stopped';
}

agent_uptime_count.GAP_MS = GAP_MS;

module.exports = agent_uptime_count;
