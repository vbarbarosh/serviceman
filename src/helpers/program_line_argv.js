// The command line for one line of a program's life. In a container when the service names an
// image — the folder is mounted at /app and the line runs there, so `npm install` needs npm in
// the image and nothing on the machine — and on the machine itself when it does not.
const program_user = require('./program_user');
const secrets_mounts = require('./secrets_mounts');

const INSIDE = '/app';

function program_line_argv(line, dir, image, env, docker_bin, user, secrets)
{
    if ((image === null) || (image === undefined) || (image === '')) {
        return ['/bin/sh', '-c', line];
    }
    const out = [((docker_bin === undefined) ? 'docker' : docker_bin), 'run', '--rm', '--volume', `${dir}:${INSIDE}`, '--workdir', INSIDE].concat(program_user(user)).concat(secrets_mounts(secrets));
    for (const name of Object.keys(((env === undefined) || (env === null)) ? {} : env)) {
        out.push('--env', `${name}=${env[name]}`);
    }
    out.push(image, '/bin/sh', '-c', line);
    return out;
}

module.exports = program_line_argv;
