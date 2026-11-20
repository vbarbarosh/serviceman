const agent_say = require('./agent_say');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// How long the answer has to reach the host before the machine begins to go down: systemd stops
// the agent's own unit among the first, and an answer still in its socket would go with it
const AFTER_MS = 1000;
// What restarts the machine, the first of these it has: systemd's own word, then the older
// shutdown, which on a systemd machine is the same reboot
const RESTARTS = [
    {file: '/usr/bin/systemctl', argv: ['reboot']},
    {file: '/bin/systemctl', argv: ['reboot']},
    {file: '/usr/sbin/shutdown', argv: ['-r', 'now']},
    {file: '/sbin/shutdown', argv: ['-r', 'now']},
];

// The machine restarted, as root, as a person would with sudo reboot: every unit stopped as at a
// shutdown, the kernel installed last booted. The answer goes first, for after this nobody is
// here to give one; the restart a second on. A machine with neither program is refused before
// anything happens. What fails after the answer is said in this half's log alone: the host sees
// the machine still up, on the same boot, and says so.
//
//     ->   {restarting: true, by: 'systemctl reboot', uptime_ms}
//
// options.restart_root_dir puts the programs under a folder, for the tests; options.restart_run
// is what runs one, child_process.spawn's way by default.
async function agent_machine_restart(options, group)
{
    const base = (options.restart_root_dir === undefined) ? '' : options.restart_root_dir;
    const found = RESTARTS.find(v => fs.existsSync(path.join(base, v.file)));
    if (found === undefined) {
        throw new Error('this machine has neither systemctl nor shutdown to restart it with');
    }
    const file = path.join(base, found.file);
    const by = `${path.basename(found.file)} ${found.argv.join(' ')}`;
    const run = (options.restart_run === undefined) ? spawn_run : options.restart_run;
    setTimeout(function () {
        agent_say(group, 'machine_restart', {by});
        run(file, found.argv, function (error) {
            agent_say(group, 'machine_restart_error', {by, reason: error.message});
        });
    }, (options.restart_after_ms === undefined) ? AFTER_MS : options.restart_after_ms);
    return {restarting: true, by, uptime_ms: Math.round(os.uptime()*1000)};
}

// The program, watched for how it ends: systemctl asks systemd for the reboot and returns at
// once with 0, the machine going down after. One that cannot start, or ends with another status,
// is an error, its last line the reason.
function spawn_run(file, argv, failed)
{
    const child = child_process.spawn(file, argv, {stdio: ['ignore', 'ignore', 'pipe']});
    let said = '';
    child.stderr.on('data', function (chunk) {
        said = (said + chunk.toString('utf8')).slice(-2000);
    });
    // A program that cannot start is said once: node follows its error with a close
    let told = false;
    function fail(error) {
        if (told === false) {
            told = true;
            failed(error);
        }
    }
    child.on('error', fail);
    child.on('close', function (code) {
        if (code !== 0) {
            fail(new Error(said.trim().split('\n').pop() || `it ended with ${code}`));
        }
    });
}

agent_machine_restart.spawn_run = spawn_run;

module.exports = agent_machine_restart;
