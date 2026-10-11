const agent_program_follow = require('./agent_program_follow');
const agent_programs_dir = require('./agent_programs_dir');
const agent_say = require('./agent_say');
const agent_services_dir = require('./agent_services_dir');
const child_process = require('child_process');
const file_write_synced = require('./file_write_synced');
const fs = require('fs');
const log_uid = require('../../helpers/log_uid');
const path = require('path');
const proc_start_time = require('./proc_start_time');

// Runs the program in its folder, so that the host can stop it again. The process group is its
// own, which is how a shell line takes its children with it when it goes.
//
// Nothing of it hangs on this agent: it writes to files, not to a pipe this process holds, and
// it is written down on the disk, pid and start time. An agent restarted, or one that dialled
// again, takes it back (agent_programs_adopt) instead of starting a second one.
//
// What it prints is written down as it prints it, under a group of the program's own: it runs
// for hours and speaks the whole time, which is exactly what a group is for.
function agent_program_start(state, params, group)
{
    const key = `${params.name}#${params.slot}`;
    const found = state.programs[key];
    if ((found !== undefined) && (proc_start_time(found.pid) === found.started)) {
        return {pid: found.pid, started: false};
    }
    const cwd = path.resolve(agent_services_dir(), ((params.cwd === null) || (params.cwd === undefined)) ? '.' : params.cwd);
    // A program with no folder of its own runs in the services folder, which is this agent's
    // to make; a folder named in the config is somebody's own, and is not made here
    if ((params.cwd === null) || (params.cwd === undefined) || (path.isAbsolute(params.cwd) === false)) {
        fs.mkdirSync(cwd, {recursive: true});
    }
    const base = path.join(agent_programs_dir(), `${params.name}.${params.slot}`);
    fs.mkdirSync(agent_programs_dir(), {recursive: true});
    // Appended to, so that emptying a file that grew too big leaves the program writing at
    // the start of it again
    fs.writeFileSync(`${base}.out`, '');
    fs.writeFileSync(`${base}.err`, '');
    const out_fd = fs.openSync(`${base}.out`, 'a');
    const err_fd = fs.openSync(`${base}.err`, 'a');
    let child;
    try {
        child = child_process.spawn(params.argv[0], params.argv.slice(1), {
            cwd,
            env: Object.assign({}, process.env, params.env || {}),
            detached: true,
            stdio: ['ignore', out_fd, err_fd],
        });
    }
    finally {
        fs.closeSync(out_fd);
        fs.closeSync(err_fd);
    }
    const own = log_uid();
    agent_say(own, 'group_spawn', ((group === undefined) ? undefined : {parent: group}));
    agent_say(own, 'program_begin', {service: params.name, slot: params.slot, pid: child.pid, cwd: params.cwd, argv: params.argv.join(' ')});
    const record = {
        name: params.name,
        slot: params.slot,
        pid: child.pid,
        started: ((child.pid === undefined) ? null : proc_start_time(child.pid)),
        cwd: params.cwd,
        dir: cwd,
        argv: params.argv,
        group: own,
    };
    if (record.started !== null) {
        file_write_synced(`${base}.json`, JSON.stringify(record));
    }
    agent_program_follow(state.programs, record, child, own);
    return {pid: child.pid, started: true};
}

module.exports = agent_program_start;
