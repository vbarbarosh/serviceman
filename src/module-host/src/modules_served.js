const apt_run = require('../../main/src/helpers/apt_run');
const container_disk = require('../../../modules/docker/server/container_disk');
const disks_manifest = require('../../../modules/disks/server/disks_manifest');
const disks_serve = require('../../../modules/disks/server/disks_serve');
const docker_exec_connect = require('../../main/src/helpers/docker_exec_connect');
const docker_manifest = require('../../../modules/docker/server/docker_manifest');
const docker_serve = require('../../../modules/docker/server/docker_serve');
const docker_shell = require('../../main/src/helpers/docker_shell');
const file_manager_manifest = require('../../../modules/file_manager/server/file_manager_manifest');
const file_manager_serve = require('../../../modules/file_manager/server/file_manager_serve');
const firewall_manifest = require('../../../modules/firewall/server/firewall_manifest');
const firewall_serve = require('../../../modules/firewall/server/firewall_serve');
const log_event = require('../../main/src/helpers/log_event');
const machine_host = require('./machine_host');
const packages_manifest = require('../../../modules/packages/server/packages_manifest');
const packages_serve = require('../../../modules/packages/server/packages_serve');
const path = require('path');
const processes_manifest = require('../../../modules/processes/server/processes_manifest');
const processes_serve = require('../../../modules/processes/server/processes_serve');
const remote_call = require('../../main/src/helpers/remote_call');
const remote_disk = require('../../main/src/helpers/remote_disk');
const stream_open = require('../../main/src/helpers/stream_open');
const term_create_refusal = require('../../helpers/term_create_refusal');
const term_name_valid = require('../../helpers/term_name_valid');
const terminal_manifest = require('../../../modules/terminal/server/terminal_manifest');
const terminal_serve = require('../../../modules/terminal/server/terminal_serve');
const volumes_manifest = require('../../../modules/volumes/server/volumes_manifest');
const volumes_serve = require('../../../modules/volumes/server/volumes_serve');

// How long a read of this computer may take, a firewall command and a volume's work: as
// serviceman waits for a machine
const READ_TIMEOUT_MS = 15000;
const UFW_TIMEOUT_MS = 40000;
const VOLUME_TIMEOUT_MS = 600000;
// How long a request that came before the agent's hello waits for it: it says hello within a
// second of module-host's start, and again a second after a link that dropped
const HELLO_WAIT_MS = 10000;
const HELLO_STEP_MS = 50;

const RE_CONTAINER_FS = /^\/containers\/([0-9a-f]{12,64})\/fs(\/.*)?$/;

const MODULES = path.resolve(__dirname, '../../../modules');

// The modules this app loads, each given what it asks of its host by this computer: the
// ServiceMan agent's own code, run in this process (machine_host), answering the same calls
// serviceman makes of a machine whose agent dialled in.
//
//     ui        the folder of its page half, served at /_/<key>/
//     page      the component the page opens, when it is not the module's own <key>.js: a
//               module whose page half is only a part (the Terminal's pane) is opened in the
//               control page's own component around it
//     manifest  what it holds and does, which its lists are drawn from
//     serve     its API at /api/<key>, with the address after that as tail
const modules_served = [
    {
        key: 'processes',
        title: 'Processes',
        ui: path.join(MODULES, 'processes/ui'),
        manifest: processes_manifest,
        serve: function (req, res, tail) {
            return processes_serve(req, res, {read: () => machine_read('proc_list'), tail});
        },
    },
    {
        key: 'disks',
        title: 'Disks',
        ui: path.join(MODULES, 'disks/ui'),
        manifest: disks_manifest,
        serve: function (req, res, tail) {
            return disks_serve(req, res, {read: () => machine_read('disk_list'), tail});
        },
    },
    {
        key: 'packages',
        title: 'Packages',
        ui: path.join(MODULES, 'packages/ui'),
        manifest: packages_manifest,
        serve: function (req, res, tail) {
            const {app, remote} = machine_host();
            return packages_serve(req, res, {
                read: () => machine_read('package_list'),
                // apt runs as root through the root half where this computer has one, and as
                // sudo -n where it has not, which answers only where a sudoers line lets it
                upgrade: function () {
                    if (remote.state.apt.phase === 'running') {
                        throw status_error(409, 'an upgrade is already running here');
                    }
                    apt_run(app, remote).catch(function (error) {
                        log_event(app, 'apt_containers_error', {reason: error.message});
                    });
                    return {started: true, stream: remote.state.apt.stream, url: remote.state.apt.url};
                },
                run: () => remote.state.apt,
                cancel: function () {
                    if (remote.state.apt.phase !== 'running') {
                        return {stopped: false, reason: 'nothing is being installed here'};
                    }
                    return remote_call(app, remote, 'apt_cancel', {});
                },
                tail,
            });
        },
    },
    {
        key: 'docker',
        title: 'Docker',
        ui: path.join(MODULES, 'docker/ui'),
        manifest: docker_manifest,
        serve: async function (req, res, tail) {
            const {app, remote} = machine_host();
            let connect;
            try {
                connect = docker_exec_connect(app, await online(remote));
            }
            catch (error) {
                send_json(res, 409, {error: (error.status === undefined) ? 'docker on this computer has no socket the agent can reach' : error.message});
                return;
            }
            // A container's files: the File Manager's API, over a disk the Docker module makes of it
            const files = RE_CONTAINER_FS.exec(tail);
            if (files !== null) {
                await file_manager_serve(req, res, {disk: container_disk(connect, files[1]), tail: (files[2] === undefined) ? '' : files[2], name: files[1].slice(0, 12), log: log_of(app)});
                return;
            }
            await docker_serve(req, res, {
                connect,
                run: v => docker_shell(app, remote, v),
                stream: v => stream_open(app, {title: v, base: '/api/docker'}),
                tail,
                log: log_of(app),
            });
        },
    },
    {
        key: 'file_manager',
        title: 'Files',
        ui: path.join(MODULES, 'file_manager/ui'),
        manifest: file_manager_manifest,
        serve: async function (req, res, tail) {
            const {app, remote} = machine_host();
            try {
                await online(remote);
            }
            catch (error) {
                send_json(res, error.status, {error: error.message});
                return;
            }
            await file_manager_serve(req, res, {disk: remote_disk(app, remote), tail, name: remote.name, log: log_of(app)});
        },
    },
    {
        key: 'terminal',
        title: 'Terminal',
        ui: path.join(MODULES, 'terminal/ui'),
        page: '/remote_shell.js',
        manifest: terminal_manifest,
        serve: function (req, res, tail) {
            const {app, remote} = machine_host();
            return terminal_serve(req, res, {
                call: (method, params) => terminal_call(method, params),
                // Joined once, within a minute, by a WebSocket at its address (upgrade_answer)
                join: function (name) {
                    if (term_name_valid(name) === false) {
                        throw status_error(400, `a terminal name is letters, digits, - and _, at most 64 of them: ${JSON.stringify(name)}`);
                    }
                    const stream = stream_open(app, {title: `the terminal ${name}`, base: '/api/terminal', command: 'join', item: name, join: {remote: remote.name, term: name}});
                    return {stream: stream.id, url: stream.url};
                },
                tail,
            });
        },
    },
    {
        key: 'firewall',
        title: 'Firewall',
        ui: path.join(MODULES, 'firewall/ui'),
        manifest: firewall_manifest,
        serve: function (req, res, tail) {
            const {app, remote} = machine_host();
            return firewall_serve(req, res, {
                run: async v => remote_call(app, await online(remote), 'ufw', {argv: v}, UFW_TIMEOUT_MS),
                ports: () => machine_read('port_list'),
                tail,
                log: log_of(app),
            });
        },
    },
    {
        key: 'volumes',
        title: 'Volumes',
        ui: path.join(MODULES, 'volumes/ui'),
        manifest: volumes_manifest,
        serve: function (req, res, tail) {
            const {app, remote} = machine_host();
            return volumes_serve(req, res, {
                call: v => volume_call(v),
                // The page is this computer's own, on its loopback (request_allowed): a key
                // typed there never leaves it
                key_safe: true,
                tail,
                log: log_of(app),
            });
        },
    },
];

// One read of this computer, by the agent's own call
async function machine_read(method)
{
    const {app, remote} = machine_host();
    return remote_call(app, await online(remote), method, {}, READ_TIMEOUT_MS);
}

// A volume's work, done by the agent's root half: the agent's refusal where there is none
// names serviceman's page, which module-host has not
async function volume_call(params)
{
    const {app, remote} = machine_host();
    const answer = await remote_call(app, await online(remote), 'volume', params, VOLUME_TIMEOUT_MS);
    if ((answer.ok === false) && (answer.status === 501)) {
        return Object.assign({}, answer, {error: 'volumes need the agent\'s root half on this computer, which answers at /run/serviceman-root.sock: serviceman\'s Install tab installs it (src/module-host/README.md)'});
    }
    return answer;
}

// What the Terminal module asks, with the refusals serviceman makes: a name or an env it would
// not take
async function terminal_call(method, params)
{
    const {app, remote} = machine_host();
    await online(remote);
    if (method === 'term_list') {
        return remote_call(app, remote, method, params, READ_TIMEOUT_MS);
    }
    const refused = (method === 'term_create') ? term_create_refusal(params.env, params.cwd) : null;
    if (refused !== null) {
        throw status_error(400, refused);
    }
    // An empty env or folder is none: the shell's own
    const asked = (method === 'term_create') ? Object.assign({}, params, {env: params.env || undefined, cwd: params.cwd || undefined}) : params;
    if (term_name_valid(asked.name) === false) {
        throw status_error(400, `a terminal name is letters, digits, - and _, at most 64 of them: ${JSON.stringify(asked.name)}`);
    }
    return remote_call(app, remote, method, asked, READ_TIMEOUT_MS).catch(function (error) {
        throw status_error(400, error.message);
    });
}

// A page opened with module-host's start asks before the agent said hello, and waits for it
async function online(remote)
{
    for (let waited = 0; (remote.state.phase !== 'online') && (waited < HELLO_WAIT_MS); waited += HELLO_STEP_MS) {
        await new Promise(v => setTimeout(v, HELLO_STEP_MS));
    }
    if (remote.state.phase !== 'online') {
        throw status_error(503, 'the agent in module-host did not start: its lines in module-host\'s output say why');
    }
    return remote;
}

function log_of(app)
{
    return function (event, fields) {
        log_event(app, event, fields);
    };
}

function status_error(status, message)
{
    const out = new Error(message);
    out.status = status;
    return out;
}

function send_json(res, status, value)
{
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(JSON.stringify(value, null, 4));
}

module.exports = modules_served;
