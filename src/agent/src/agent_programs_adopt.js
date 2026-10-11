const agent_program_follow = require('./agent_program_follow');
const agent_programs_dir = require('./agent_programs_dir');
const agent_say = require('./agent_say');
const fs = require('fs');
const path = require('path');
const proc_start_time = require('./proc_start_time');

// The programs an agent before this one started, taken back: each one still running is watched
// again, under the group it began in, and answers probe, logs and stop as if this agent had
// started it. A note whose process is gone, or whose pid now belongs to another process, is
// taken away with its files.
function agent_programs_adopt(programs, group)
{
    const dir = agent_programs_dir();
    let names;
    try {
        names = fs.readdirSync(dir).filter(v => v.endsWith('.json'));
    }
    catch {
        return;
    }
    for (const name of names) {
        const file = path.join(dir, name);
        let record;
        try {
            record = JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        catch {
            fs.rmSync(file, {force: true});
            continue;
        }
        if (proc_start_time(record.pid) !== record.started) {
            const base = file.slice(0, -'.json'.length);
            for (const ext of ['.json', '.out', '.err']) {
                fs.rmSync(`${base}${ext}`, {force: true});
            }
            continue;
        }
        const own = ((typeof record.group === 'string') ? record.group : group);
        agent_say(own, 'program_adopted', {service: record.name, slot: record.slot, pid: record.pid});
        agent_program_follow(programs, record, null, own);
    }
}

module.exports = agent_programs_adopt;
