const EventEmitter = require('events');
const agent_fs_path = require('./agent_fs_path');
const {spawn} = require('child_process');

// What a chosen name may be: a name of the folder itself, nothing that walks out of it
const RE_NAME = /^[^/\\]+$/;

// Several names of one folder, answered as one tar the machine writes on the way out. tar
// itself walks what it is given, so a chosen folder comes whole. With `paths`, a name may be a
// path under the folder, `a/b/c.txt`, and never one that walks out of it.
//
//     target = {dir, names, paths}
//
// Each name goes to tar as ./<name>, so a file called -x or --to-command is a file to tar and
// never one of its options.
function agent_tar_get(target)
{
    const names = (Array.isArray(target.names) ? target.names.map(String) : []);
    if (names.length === 0) {
        throw new Error('nothing is named to take');
    }
    for (const name of names) {
        const parts = ((target.paths === true) ? name.split('/') : [name]);
        if (parts.some(v => (RE_NAME.test(v) === false) || (v === '.') || (v === '..'))) {
            throw new Error(`a name of the folder itself is wanted, and ${JSON.stringify(name)} is not one`);
        }
    }
    const child = spawn('tar', ['-cf', '-', '-C', agent_fs_path(target.dir)].concat(names.map(v => `./${v}`)));
    const said = [];
    const out = new EventEmitter();
    out.destroyed = false;
    out.setNoDelay = function () {};
    out.write = function () {};
    out.end = function () {};
    out.pause = function () {
        child.stdout.pause();
    };
    out.resume = function () {
        child.stdout.resume();
    };
    out.destroy = function () {
        out.destroyed = true;
        child.kill('SIGKILL');
    };
    child.stdout.on('data', function (chunk) {
        out.emit('data', chunk);
    });
    child.stderr.on('data', function (chunk) {
        said.push(chunk);
    });
    child.on('error', function (error) {
        out.emit('error', error);
    });
    child.on('close', function (code) {
        if (out.destroyed) {
            return;
        }
        // 1 is GNU tar's "file changed as we read it": the tar is whole, a live log in it is
        // as it was when read
        if ((code !== 0) && (code !== 1)) {
            const lines = Buffer.concat(said).toString('utf8').trim().split('\n');
            out.emit('error', new Error(lines[lines.length - 1] || `tar ended with ${code}`));
            return;
        }
        out.emit('end');
        out.destroyed = true;
        out.emit('close');
    });
    return out;
}

module.exports = agent_tar_get;
