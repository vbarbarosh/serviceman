const link_send = require('../../../helpers/link_send');
const remote_call_wait = require('./remote_call_wait');

const BLAST_TIMEOUT_MS = 60000;

// Sends filler bytes the agent throws straight back; how long that takes is the speed of the link
function remote_blast(app, remote, bytes)
{
    const state = remote.state;
    if (state.phase !== 'online') {
        return Promise.reject(new Error(`remote ${remote.name} is ${state.phase} — its agent is not dialled in`));
    }
    const id = ++state.next_call_id;
    const out = remote_call_wait(remote, id, BLAST_TIMEOUT_MS);
    const body = Buffer.alloc(4 + bytes);
    body.writeUInt32BE(id, 0);
    link_send(state.socket, 'b', body);
    return out;
}

module.exports = remote_blast;
