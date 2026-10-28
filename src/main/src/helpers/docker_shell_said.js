const docker_lane = require('./docker_lane');
const docker_shell = require('./docker_shell');

// The runs waiting on their lines, by lane
const waiting = new Map();
let lanes_made = 0;

// One docker command on a machine, each line it prints handed to `said` as it is printed: the
// call names a lane of its own, so the agent says every line up the link, where it is written
// to the log like any line of a machine's and handed here on its way (docker_shell_said.said).
// The lines come before the answer, on the same link. Without `said` it is a quiet command.
//
//     said(line)   the line, its terminal escapes gone
//     ->           {ok, code, stdout, stderr}, as docker_shell
async function docker_shell_said(app, remote, argv, said)
{
    if (typeof said !== 'function') {
        return await docker_shell(app, remote, argv);
    }
    lanes_made++;
    const lane = `${docker_lane}${lanes_made}`;
    waiting.set(lane, said);
    try {
        return await docker_shell(app, remote, argv, lane);
    }
    finally {
        waiting.delete(lane);
    }
}

// A line a machine said under a docker lane, for the run waiting on it; a run that is over
// has nobody to hand it to
docker_shell_said.said = function (lane, text) {
    const said = waiting.get(lane);
    if (said !== undefined) {
        said(text);
    }
};

module.exports = docker_shell_said;
