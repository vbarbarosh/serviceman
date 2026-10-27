const agent_docker_socket = require('./agent_docker_socket');
const agent_root_or = require('./agent_root_or');
const agent_security_sshd = require('./agent_security_sshd');
const agent_shell = require('./agent_shell');
const apt_periodic_from_dump = require('./apt_periodic_from_dump');
const distro_eol_from_csv = require('./distro_eol_from_csv');
const docker_api = require('./docker_api');
const docker_published_from_list = require('./docker_published_from_list');
const fs = require('fs');
const os_from_release = require('./os_from_release');
const path = require('path');

const READ_TIMEOUT_MS = 20000;
const OS_RELEASE = ['/etc/os-release', '/usr/lib/os-release'];
// What the agent's user cannot read is the root half's to read; said at the end of why not
const ROOT_NONE = 'the root half reads it';
const ROOT_OLD = 'the root half here is older than this check and updates itself within half a minute';

// What this machine shows of how safe it is, for serviceman's Security page: the system and
// when its updates end, whether apt installs updates by itself, what Docker publishes and on
// which addresses, sshd's settings and the sign-ins it refused in the last day. sshd's files
// and its journal are root's to read: the root half reads them where the machine has one
// (`root`), the agent's own user what it may where it has none. Every part is read, never
// changed, and one that cannot be read says why rather than failing the rest.
//
//     -> {root, os, ssh, failures, auto_updates, docker}
async function agent_security(options)
{
    const base = (options.security_root_dir === undefined) ? '' : options.security_root_dir;
    const answers = await Promise.all([sshd_read(options), os_read(base), auto_updates_read(base), docker_read(options)]);
    return {root: answers[0].root, os: answers[1], ssh: answers[0].ssh, failures: answers[0].failures, auto_updates: answers[2], docker: answers[3]};
}

async function sshd_read(options)
{
    try {
        const answer = await agent_root_or(options, 'security_root', {}, undefined, async function (why) {
            return Object.assign({root: false}, await agent_security_sshd(options, {root: false, why: (why.root_old === true) ? ROOT_OLD : ROOT_NONE}));
        });
        return Object.assign({root: true}, answer);
    }
    catch (error) {
        return Object.assign({root: false}, await agent_security_sshd(options, {root: false, why: `the root half failed: ${error.message}`}));
    }
}

// The system and when its updates end, as distro-info lists it on the machine itself: a
// release the machine's list is too old to know has no end said
function os_read(base)
{
    const file = OS_RELEASE.map(v => path.join(base, v)).find(v => fs.existsSync(v));
    if (file === undefined) {
        return null;
    }
    const system = Object.assign(os_from_release(fs.readFileSync(file, 'utf8')), {eol: null, eol_extended: null});
    if ((system.id === null) || (/^[a-z0-9._-]+$/.test(system.id) === false)) {
        return system;
    }
    try {
        return Object.assign(system, distro_eol_from_csv(system.id, system.codename, fs.readFileSync(path.join(base, '/usr/share/distro-info', `${system.id}.csv`), 'utf8')));
    }
    catch {
        return system;
    }
}

// Whether apt installs updates by itself: unattended-upgrades there, and apt told to run it
async function auto_updates_read(base)
{
    const apt_config = path.join(base, '/usr/bin/apt-config');
    if (fs.existsSync(apt_config) === false) {
        return null;
    }
    const answer = await agent_shell([apt_config, 'dump'], {timeout: READ_TIMEOUT_MS});
    const setting = answer.ok ? apt_periodic_from_dump(answer.stdout) : null;
    const installed = fs.existsSync(path.join(base, '/usr/bin/unattended-upgrade'));
    return {installed, on: installed && (setting !== null) && (setting !== '0'), setting};
}

// The running containers and the ports they publish; null on a machine with no docker
async function docker_read(options)
{
    let socket;
    try {
        socket = await agent_docker_socket(options);
    }
    catch (error) {
        return {error: `docker: ${error.message}`};
    }
    if (fs.existsSync(socket) === false) {
        return null;
    }
    let timer = null;
    const late = new Promise(function (resolve, reject) {
        timer = setTimeout(() => reject(new Error(`no answer in ${READ_TIMEOUT_MS/1000} s`)), READ_TIMEOUT_MS);
    });
    try {
        return docker_published_from_list(await Promise.race([docker_api.json(socket, '/containers/json'), late]));
    }
    catch (error) {
        return {error: (error.code === 'EACCES') ? `docker: permission denied on ${socket}` : `docker: ${error.message}`};
    }
    finally {
        clearTimeout(timer);
    }
}

module.exports = agent_security;
