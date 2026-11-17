const link_send_stream = require('../../../helpers/link_send_stream');
const log_event = require('./log_event');
const path = require('path');
const sftp_stream = require('../../../helpers/sftp_stream');
const tunnel_open = require('./tunnel_open');
const tunnel_stream = require('./tunnel_stream');

// The sshfs of a mount dialled its "ssh" on the machine it is mounted on (agent_mounts there),
// which opened a stream over its link: here it is joined to the folder, served over SFTP on the
// machine the folder is on (sftp_stream there), or by serviceman itself for a folder of its own
// state dir. Byte for byte, until either end closes; one that cannot be joined is refused at once
// with the reason, and sshfs over there tries again.
//
// Only the mount's own `to` machine may open it, and only while it is on: a machine that names
// somebody else's mount is asking this host for a folder that is not its to see.
function mount_join(app, remote, id, label)
{
    const state = remote.state;
    const mount = app.config.mounts.find(v => v.label === label);
    if ((mount === undefined) || (mount.off) || (mount.to.remote !== remote.name)) {
        refuse(state, id, 'EBADTARGET', `${remote.name} has no mount named ${label}`);
        return;
    }
    const counts = mount_counts(app, label);
    let far;
    try {
        far = far_open(app, mount);
    }
    catch (error) {
        failed(app, counts, label, error.message);
        refuse(state, id, 'EHOSTDOWN', error.message);
        return;
    }
    const near = tunnel_stream(state.socket, id, true);
    state.streams[id] = near;
    near.id = id;
    near.on('close', function () {
        delete state.streams[id];
    });
    counts.open++;
    counts.total++;
    near.on('data', function (chunk) {
        counts.bytes_sent += chunk.length;
    });
    far.on('data', function (chunk) {
        counts.bytes_back += chunk.length;
    });
    far.on('error', function (error) {
        failed(app, counts, label, from_words(mount, error.message));
        near.destroy(error);
    });
    near.on('error', function (error) {
        far.destroy(error);
    });
    let closed = 0;
    function close() {
        closed++;
        if (closed === 2) {
            counts.open--;
        }
    }
    near.on('close', close);
    far.on('close', close);
    near.pipe(far);
    far.pipe(near);
}

// The folder's end: a stream to the machine it is on, or serviceman's own server of a folder of
// its state dir. Throws while that machine is away.
function far_open(app, mount)
{
    if (mount.from.here) {
        return sftp_stream(path.join(app.state_dir, mount.from.path), {read_only: mount.mode !== 'rw'});
    }
    const from = app.remote_by_name[mount.from.remote];
    try {
        return tunnel_open(from, {sftp: {path: mount.from.path, mode: mount.mode}});
    }
    catch {
        throw new Error(`${mount.from.remote} is offline`);
    }
}

function from_words(mount, reason)
{
    return mount.from.here ? reason : `${mount.from.remote}: ${reason}`;
}

// What went through one mount, sent to the folder and back, by label; the page shows it
function mount_counts(app, label)
{
    if (app.mount_counts[label] === undefined) {
        // open_joined: of the open ones, those its agent joins itself and last said; peer_away:
        // why its agent's last connection went through serviceman, its peer not answering, or
        // null (mounts_counts_apply)
        app.mount_counts[label] = {open: 0, open_joined: 0, peer_away: null, total: 0, bytes_sent: 0, bytes_back: 0, error: null, error_at: null};
    }
    return app.mount_counts[label];
}

// The last failure is shown until the next one; the log has it once per reason in a row
function failed(app, counts, label, reason)
{
    if (counts.error !== reason) {
        log_event(app, 'mount_error', {mount: label, reason});
    }
    counts.error = reason;
    counts.error_at = Date.now();
}

function refuse(state, id, code, message)
{
    link_send_stream(state.socket, 'x', id, Buffer.from(JSON.stringify({code, message})));
}

mount_join.counts = mount_counts;
mount_join.failed = failed;

module.exports = mount_join;
