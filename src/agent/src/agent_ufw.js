const child_process = require('child_process');

// What may be asked of ufw: its own subcommands and nothing else. `--force` only answers its
// question about ssh in advance, since nobody is at this end to answer it.
const SUBCOMMANDS = ['status', 'show', 'allow', 'deny', 'reject', 'limit', 'delete', 'insert', 'enable', 'disable'];
const TIMEOUT_MS = 30000;

// ufw run with the words given, as root: by the root half, or here with sudo in front where
// there is none. Every word goes to ufw as one argument, with no shell between, so a comment
// is a comment whatever it says.
//
//     params = {argv: ['status', 'numbered']}
//     -> {ok, code, stdout, stderr}
function agent_ufw(options, params)
{
    const argv = Array.isArray(params.argv) ? params.argv.map(String) : [];
    const first = (argv[0] === '--force') ? argv[1] : argv[0];
    if (SUBCOMMANDS.includes(first) === false) {
        return Promise.reject(new Error(`ufw is asked only for ${SUBCOMMANDS.join(', ')}, not ${JSON.stringify((first === undefined) ? '' : first)}`));
    }
    if (argv.some(v => v.includes('\n') || v.includes('\0'))) {
        return Promise.reject(new Error('a word for ufw may not hold a line break'));
    }
    const command = ufw_command(options);
    return new Promise(function (resolve) {
        child_process.execFile(command[0], command.slice(1).concat(argv), {timeout: TIMEOUT_MS, env: Object.assign({}, process.env, {LC_ALL: 'C'})}, function (error, stdout, stderr) {
            if ((error !== null) && (typeof error.code !== 'number')) {
                // Not there, or not allowed to run: said the way ufw's own refusal is
                resolve({ok: false, code: -1, stdout: String(stdout || ''), stderr: (error.code === 'ENOENT') ? `${command[0]}: not found` : error.message});
                return;
            }
            resolve({ok: (error === null), code: (error === null) ? 0 : error.code, stdout: String(stdout), stderr: String(stderr)});
        });
    });
}

// What ufw is on this machine: as given, or with sudo in front of it where the agent is not
// root, so a sudoers line may name ufw and nothing else
function ufw_command(options)
{
    if ((options !== undefined) && (options.ufw !== undefined) && (options.ufw !== '')) {
        return options.ufw.split(' ').filter(v => v !== '');
    }
    return ((process.getuid !== undefined) && (process.getuid() === 0)) ? ['ufw'] : ['sudo', '-n', 'ufw'];
}

module.exports = agent_ufw;
