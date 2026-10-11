const agent_addresses = require('./agent_addresses');
const agent_can = require('./agent_can');
const agent_dir = require('./agent_dir');
const agent_disk = require('./agent_disk');
const agent_doors_state = require('./agent_doors_state');
const agent_logline_read = require('./agent_logline_read');
const agent_os = require('./agent_os');
const agent_peer_serve = require('./agent_peer_serve');
const agent_shell = require('./agent_shell');
const crypto = require('crypto');
const docker_socket_path = require('../../helpers/docker_socket_path');
const os = require('os');

// What the machine is: said once, when the link opens
async function agent_resources(options)
{
    const cpus = os.cpus();
    const disk = await agent_disk(options.dir);
    const docker = await agent_shell([options.docker, 'version', '--format', '{{.Server.Version}}']);
    const can = await agent_can(options);
    return {
        hostname: os.hostname(),
        // Who the agent is on that machine: whose desktop session it can reach, whose shell a
        // terminal opens, and the name a sudoers line has to carry
        user: os.userInfo().username,
        os: agent_os(),
        platform: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        node: process.version,
        cpu: {
            count: cpus.length,
            model: ((cpus.length === 0) ? 'unknown' : cpus[0].model.trim()),
        },
        mem: {total: os.totalmem()},
        disk,
        docker: (docker.ok ? `docker ${docker.stdout}` : null),
        // The host reaches this socket through the link when it wants a shell in a container
        docker_socket: docker_socket_path({}, process.env),
        // What this agent can be asked for, by name. The host reads the list before asking:
        // a feature not named here is one this agent predates, and it is not asked.
        can,
        // Where this agent lives. What a service keeps is a folder under it, and the host has
        // to write that path into a `docker run` line it builds here.
        dir: agent_dir(),
        // Where other machines see this one: what Logline binds this machine's token to
        addresses: agent_addresses(),
        // What it was last told about Logline, so the host tells it only what changed. The
        // token is named by its hash: it is not the host's to read back.
        logline: logline_said(),
        // Which door table it serves from, so the host sends one only when it differs, and
        // where its peers reach it
        doors: {version: ((agent_doors_state.table === null) ? null : agent_doors_state.table.version), peer: agent_peer_serve.where()},
    };
}

// null when the file cannot be read: the host then tells it afresh, and the telling says why
// it fails
function logline_said()
{
    let kept;
    try {
        kept = agent_logline_read();
    }
    catch {
        return null;
    }
    return {
        logs: kept.logs,
        endpoint: kept.endpoint,
        token_sha: ((kept.token === null) ? null : crypto.createHash('sha256').update(kept.token).digest('hex')),
        floor: kept.floor,
        dirs: kept.dirs,
    };
}

module.exports = agent_resources;
