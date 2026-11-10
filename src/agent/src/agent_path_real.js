const fs = require('fs');
const path = require('path');

// Where a full path leads on this machine, for what the root half does to it as root: a folder
// mounted on, made, handed over, moved aside. A link in a folder its owner may write makes the
// path name any folder of the machine, so no link is followed below `base`: the first one
// found is the answer, for a refusal that names it. `base` is the part the system itself
// names, a home out of passwd, or / for none: the links in it are the system's own and are
// followed, so a home kept on another disk (/home -> /data/home) is its real folder. What is
// not there yet has no link in it, and is made plain.
//
//     ('/home/user/projects', '/home/user')  ->  {path: '/data/home/user/projects', link: null, to: null}
//     ('/home/user/l/sbin', '/home/user')    ->  {path: null, link: '/home/user/l', to: '/usr/local'}
//     a base that is not there               ->  {path: null, link: null, to: null}
function agent_path_real(given, base)
{
    let real;
    try {
        real = fs.realpathSync(base);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return {path: null, link: null, to: null};
        }
        throw error;
    }
    const parts = path.relative(base, given).split(path.sep);
    for (let i = 0; i < parts.length; ++i) {
        const next = path.join(real, parts[i]);
        const to = link_read(next);
        if (to === undefined) {
            return {path: path.join(real, ...parts.slice(i)), link: null, to: null};
        }
        if (to !== null) {
            return {path: null, link: path.join(base, ...parts.slice(0, i + 1)), to};
        }
        real = next;
    }
    return {path: real, link: null, to: null};
}

// Where a link leads: null for what is there and is no link, undefined for what is not there.
// One question to the machine, so the answer is of one moment.
function link_read(file)
{
    try {
        return fs.readlinkSync(file);
    }
    catch (error) {
        if (error.code === 'EINVAL') {
            return null;
        }
        if (error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

module.exports = agent_path_real;
