const fs = require('fs');

// The stand-in docker (tests/bin/docker) keeps its containers as real little servers, a process
// each, noted in the file SERVICEMAN_TEST_STATE names: every one of them is stopped, so that a
// test leaves none behind
function containers_kill()
{
    let state;
    try {
        state = JSON.parse(fs.readFileSync(process.env.SERVICEMAN_TEST_STATE, 'utf8'));
    }
    catch {
        return;
    }
    for (const name of Object.keys(state.containers)) {
        const found = state.containers[name];
        if (found.pid === null) {
            continue;
        }
        try {
            process.kill(found.pid, 'SIGKILL');
        }
        catch {
            // already gone
        }
    }
}

module.exports = containers_kill;
