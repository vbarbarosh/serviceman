// The container a shell service runs in when it names an image. The image is the environment,
// the folder is the program, the command is yours — and the name, the labels and the published
// port are what serviceman puts on every container it makes, so the same driver stops it and
// finds it again.
const program_user = require('./program_user');
const secrets_mounts = require('./secrets_mounts');
const volume_text = require('./volume_text');

const INSIDE = '/app';
// Where docker publishes the program's port: the loopback of the machine that runs it, which is
// where the agent's tunnel reaches it
const PUBLISHED_AT = '127.0.0.1';

// What the program keeps: a folder of the agent's, a named volume of docker's, or a path on
// that machine — mounted where the program looks for it
function volume_mounts(volumes, keep_root)
{
    const out = [];
    for (const volume of (((volumes === undefined) || (volumes === null)) ? [] : volumes)) {
        out.push('--volume', volume_text(volume, keep_root));
    }
    return out;
}

function program_docker_argv(params)
{
    const out = [
        'run', '-d',
        // An init as pid 1. A command that ends in `exec` makes the program itself pid 1 of the
        // container, and the kernel throws away every signal pid 1 has no handler for — so
        // `docker stop` waits out its whole timeout and kills it. With this, docker's own init
        // is pid 1, the program is its child with ordinary signal rules, and a stop takes
        // milliseconds. See notes/signals-through-a-process-chain.md.
        '--init',
        '--name', params.container,
        '--label', `serviceman.service=${params.service}`,
        '--label', `serviceman.spec=${params.spec}`,
        '--volume', `${params.dir}:${INSIDE}`,
        '--workdir', INSIDE,
    ].concat(program_user(params.user)).concat(secrets_mounts(params.secrets)).concat(volume_mounts(params.volumes, params.keep_root));
    if ((params.port !== null) && (params.port !== undefined)) {
        out.push('--publish', `${PUBLISHED_AT}::${params.port}`);
    }
    for (const name of Object.keys(((params.env === undefined) || (params.env === null)) ? {} : params.env)) {
        out.push('--env', `${name}=${params.env[name]}`);
    }
    out.push(params.image, '/bin/sh', '-c', params.command);
    return out;
}

module.exports = program_docker_argv;
