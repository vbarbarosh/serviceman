const agent_bundle = require('../src/agent/bundler/agent_bundle');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const remote_state = require('../src/main/src/helpers/remote_state');
const test = require('node:test');
const timers = require('timers/promises');

test('an agent that says it started and comes back as itself is said to be stuck', async function () {
    // The agent is a stand-in that answers every ask the way a stuck one does: started, and
    // nothing ever changes. It is put in place before the updater is loaded, which reads it.
    const remote_call_path = require.resolve('../src/main/src/helpers/remote_call');
    require.cache[remote_call_path] = {id: remote_call_path, filename: remote_call_path, loaded: true, exports: remote_call_stuck};
    const remotes_update = require('../src/main/src/helpers/remotes_update');
    const remote = {name: 'vps1', state: Object.assign(remote_state(), {phase: 'online', agent_built: 'an old build'})};
    // The ask carries the host's signature of the file, from the key in the state dir
    const app = {config: {agent_update: true}, remotes: [remote], log_lines: [], state_dir: fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-sign-'))};

    remotes_update(app);
    await timers.setImmediate();
    assert.strictEqual(remote.state.update_not_taken, 0, 'one ask is not yet an ask that did not take');
    assert.strictEqual(remote.state.update_refused, null);

    // The next ask comes round, and the machine is still what it was
    remote.state.update_asked_at -= 600001;
    remotes_update(app);
    await timers.setImmediate();
    assert.strictEqual(remote.state.update_not_taken, 1);
    assert.match(remote.state.update_refused, /^it says it started, and it still runs its old build after 1 ask/);
    assert.strictEqual(app.log_lines.some(v => /\[remote_update_not_taken\] remote=vps1 running="an old build" serving=\S+ asked=1/.test(v)), true);

    // It takes the update at last: nothing is said about it any more
    remote.state.agent_built = agent_bundle.built_at();
    remotes_update(app);
    assert.strictEqual(remote.state.update_refused, null);
    assert.strictEqual(remote.state.update_not_taken, 0);
});

async function remote_call_stuck()
{
    return {started: true};
}
