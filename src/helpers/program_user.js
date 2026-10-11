const INSIDE = '/app';

// Who a container of ours runs as. A container that writes into a mounted folder as root
// leaves a folder its owner cannot empty, cannot reinstall into and cannot take away — one
// `docker run` and the folder is out of reach.
//
// `user` on the service names one the image has: `node:node` in a node image. Without it, the
// user running the agent is used by number, which needs nothing of the image at all.
//
// HOME comes with it, because a tool that wants somewhere to cache — npm above all — reaches
// for /root otherwise, and that is not this user's to write either.
function program_user(user)
{
    if ((user !== null) && (user !== undefined) && (user !== '')) {
        return ['--user', user, '--env', `HOME=${INSIDE}`];
    }
    if (typeof process.getuid !== 'function') {
        return [];
    }
    return ['--user', `${process.getuid()}:${process.getgid()}`, '--env', `HOME=${INSIDE}`];
}

module.exports = program_user;
