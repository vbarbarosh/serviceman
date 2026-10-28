const assert = require('assert');
const docker_shell_said = require('../src/main/src/helpers/docker_shell_said');
const test = require('node:test');

// A machine whose link keeps what is sent on it, and whose calls this test answers
function remote_make()
{
    const sent = [];
    const socket = {destroyed: false, write: function (chunk) {
        sent.push(Buffer.from(chunk));
        return true;
    }};
    return {name: 'vps1', state: {phase: 'online', next_call_id: 0, calls: {}, socket}, sent};
}

// The call names a lane of its own; the lines said under it go to the run that waits, in order,
// and to nobody once it is over; another lane's are not its
test('a docker command\'s lines reach the run waiting on them as they come, and nobody after it ends', async function () {
    const remote = remote_make();
    const lines = [];
    const answer = docker_shell_said({}, remote, ['compose', '-p', 'shop', 'up', '-d'], v => lines.push(v));
    const asked = Buffer.concat(remote.sent).toString('utf8');
    const lane = /"service":"(#docker:[0-9]+)"/.exec(asked)[1];
    assert.match(asked, /"method":"docker"/);
    docker_shell_said.said(lane, 'Container shop-web-1  Recreated');
    docker_shell_said.said('#docker:999999', 'another run\'s line');
    docker_shell_said.said(lane, 'Container shop-web-1  Started');
    const id = Object.keys(remote.state.calls)[0];
    remote.state.calls[id].resolve({ok: true, code: 0, stdout: '', stderr: ''});
    assert.deepStrictEqual(await answer, {ok: true, code: 0, stdout: '', stderr: ''});
    docker_shell_said.said(lane, 'too late');
    assert.deepStrictEqual(lines, ['Container shop-web-1  Recreated', 'Container shop-web-1  Started']);

    // Without anyone to hand them to, the command is a quiet one: no lane
    const quiet = remote_make();
    const plain = docker_shell_said({}, quiet, ['ps'], undefined);
    assert.doesNotMatch(Buffer.concat(quiet.sent).toString('utf8'), /#docker:/);
    quiet.state.calls[Object.keys(quiet.state.calls)[0]].resolve({ok: true});
    await plain;
});
