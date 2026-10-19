const fs = require('fs');
const path = require('path');
const program_line_argv = require('./program_line_argv');
const secrets_env = require('./secrets_env');
const shell_stream = require('./shell_stream');

const MARK_FILE = '.serviceman-app';

// Puts a program's folder in place on this machine, and says whether it had to. It is the same work
// on the host and on a remote — the agent asks for this too — so the answer is a value here,
// never an exception: the caller decides what a failed install means.
async function program_install_here(dir, install, update, mark, env, look, made, image, docker_bin, user, say, secrets, force)
{
    fs.mkdirSync(dir, {recursive: true});
    const file = path.join(dir, MARK_FILE);
    const found = mark_read(file);
    if ((install === null) || (install === undefined) || ((found === mark) && (force !== true))) {
        return {step: null, ok: true, stdout: '', stderr: ''};
    }
    // A folder that is already something gets the update line when there is one: the install
    // line is for an empty folder, and running it over a working copy is a different thing
    const step = ((found === null) || (update === null) || (update === undefined)) ? 'install' : 'update';
    // Asked what it would do, and not to do it: the host says a line is about to run before it
    // runs, and says nothing at all when nothing needs running
    if (look === true) {
        return {step, ok: true, stdout: '', stderr: ''};
    }
    // An install line is written for an empty folder — `git clone .` says so itself — and half
    // of a failed install is worse than none of it: the next try would meet its own leftovers
    // and fail on those instead. So a folder serviceman made is emptied before the line runs
    // and taken away again if it fails. A folder somebody named is theirs, and is left alone.
    if ((step === 'install') && (made === true)) {
        try {
            fs.rmSync(dir, {recursive: true, force: true});
        }
        catch (error) {
            return {step, ok: false, stdout: '', stderr: `${dir} cannot be emptied: ${error.message}. Something in it belongs to another user — a container that ran as root, most likely.`};
        }
        fs.mkdirSync(dir, {recursive: true});
    }
    const line = (step === 'install') ? install : update;
    const answer = await shell_stream(program_line_argv(line, dir, image, env, docker_bin, user, secrets), {
        cwd: dir,
        env: Object.assign({}, process.env, secrets_env(secrets), env || {}),
    }, say);
    if (answer.ok) {
        fs.writeFileSync(file, `${mark}\n`);
        return Object.assign({step}, answer);
    }
    if ((step === 'install') && (made === true)) {
        try {
            fs.rmSync(dir, {recursive: true, force: true});
        }
        catch (error) {
            // The folder is out of reach — something in it belongs to somebody else. That is
            // worth saying, but the line that failed is still why we are here.
            answer.stderr = `${answer.stderr}\nthe folder could not be emptied afterwards: ${error.message}`;
        }
    }
    return Object.assign({step}, answer);
}

function mark_read(file)
{
    try {
        return fs.readFileSync(file, 'utf8').trim();
    }
    catch {
        return null;
    }
}

module.exports = program_install_here;
