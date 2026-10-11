const control_allowed = require('../control_allowed');
const control_host_allowed = require('../control_host_allowed');
const control_same_origin = require('../control_same_origin');
const docker_container_name = require('../helpers/docker_container_name');
const docker_exec_connect = require('../helpers/docker_exec_connect');
const docker_exec_open = require('../helpers/docker_exec_open');
const docker_exec_resize = require('../helpers/docker_exec_resize');
const handle_remote_upgrade = require('./handle_remote_upgrade');
const log_bind = require('../helpers/log_bind');
const log_event = require('../helpers/log_event');
const log_group_from = require('../helpers/log_group_from');
const remote_call = require('../helpers/remote_call');
const remote_can = require('../helpers/remote_can');
const remote_from_instance = require('../helpers/remote_from_instance');
const term_name_valid = require('../../../helpers/term_name_valid');
const terminal_attach = require('../../../../modules/terminal/server/terminal_attach');
const terminal_refuse = require('../../../../modules/terminal/server/terminal_refuse');
const tunnel_open = require('../helpers/tunnel_open');
const ws = require('ws');

const REMOTE_PATH = '/api/v1/remote';
const SHELL_PATH = '/api/v1/shell';

const sockets = new ws.WebSocketServer({noServer: true});

// The two long-lived doors of the control port: a shell pane into a container or a machine,
// through the Terminal module, and the link an agent on another machine dials in on
function handle_control_upgrade(app, req, socket, head)
{
    const url = new URL(req.url, 'http://serviceman.invalid');
    if (url.pathname === REMOTE_PATH) {
        handle_remote_upgrade(app, req, socket, head);
        return;
    }
    if (url.pathname !== SHELL_PATH) {
        socket.destroy();
        return;
    }
    if ((control_allowed(app, req) === false) || (control_host_allowed(app, req) === false)) {
        log_group_from(socket.log_group, function () {
            log_event(app, 'shell_refused', {from: socket.remoteAddress, reason: 'not_this_machine'});
        });
        socket.destroy();
        return;
    }
    if (control_same_origin(req) === false) {
        log_group_from(socket.log_group, function () {
            log_event(app, 'shell_cross_site_refused', {from: socket.remoteAddress, origin: req.headers.origin});
        });
        socket.destroy();
        return;
    }
    if (app.config.control.shell === false) {
        socket.destroy();
        return;
    }
    sockets.handleUpgrade(req, socket, head, function (client) {
        log_group_from(socket.log_group, function () {
            const machine = url.searchParams.get('remote');
            const container = url.searchParams.get('container');
            let promise;
            if (machine === null) {
                promise = shell_join(app, client, url.searchParams.get('service'), parseInt(url.searchParams.get('slot') || '1', 10));
            }
            else if (container === null) {
                promise = machine_join(app, client, machine, url.searchParams.get('term'));
            }
            else {
                promise = container_join(app, client, machine, container);
            }
            promise.catch(function (error) {
                terminal_refuse(client, error.message);
            });
        });
    });
}

// GET /api/v1/shell (query)
async function shell_join(app, client, name, slot)
{
    const service = app.service_by_name[name];
    if (service === undefined) {
        throw new Error(`no service named ${name}`);
    }
    if (service.type !== 'docker') {
        throw new Error(`a ${service.type} service has no container of its own to enter`);
    }
    const instance = service.state.instances.find(v => v.slot === slot);
    if ((instance === undefined) || (instance.phase !== 'running')) {
        throw new Error(`${service.name} is not running — start it first`);
    }
    const remote = remote_from_instance(app, service, instance);
    const connect = docker_exec_connect(app, remote);
    const container_name = docker_container_name(service, slot);
    const exec = await docker_exec_open(connect, container_name, {cols: 80, rows: 24});
    log_event(app, 'shell_begin', {service: service.name, instance: slot, container: container_name, remote: remote.name});
    terminal_attach(client, exec.stream, {
        note: `a shell in ${container_name} on remote ${remote.name}`,
        resize: function (size) {
            docker_exec_resize(connect, exec.id, size);
        },
        end: log_bind(function () {
            log_event(app, 'shell_end_ok', {service: service.name, instance: slot});
        }),
    });
}

// GET /api/v1/shell (query)
// A shell in any container of a machine, the one the Docker tab picked: docker exec through
// the link, joined to the pane by the Terminal module
async function container_join(app, client, name, container)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        throw new Error(`no remote named ${name}`);
    }
    if (remote.state.phase !== 'online') {
        throw new Error(`${name} is not connected`);
    }
    if (/^[0-9a-f]{12,64}$/.test(container) === false) {
        throw new Error(`${JSON.stringify(container)} is not a container id`);
    }
    const connect = docker_exec_connect(app, remote);
    const exec = await docker_exec_open(connect, container, {cols: 80, rows: 24});
    log_event(app, 'shell_begin', {remote: remote.name, container: container.slice(0, 12)});
    terminal_attach(client, exec.stream, {
        note: `a shell in container ${container.slice(0, 12)} on ${remote.name}`,
        resize: function (size) {
            docker_exec_resize(connect, exec.id, size);
        },
        end: log_bind(function () {
            log_event(app, 'shell_end_ok', {remote: remote.name, container: container.slice(0, 12)});
        }),
    });
}

// GET /api/v1/shell (query)
// A terminal on the machine itself, as the user its agent runs as: the same door the
// container shell uses, with a pty at the far end instead of docker. With `term` it joins that
// terminal kept running on the machine, made when there is none, and leaving it leaves it running.
async function machine_join(app, client, name, term)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        throw new Error(`no remote named ${name}`);
    }
    if (remote.state.phase !== 'online') {
        throw new Error(`${name} is not connected`);
    }
    // An agent from before machine shells dies on a stream target it does not know — asking it
    // would cost the whole link, and every service it carries with it
    if (remote_can(remote, 'machine_shell') === false) {
        throw new Error(`the agent on ${name} is from before machine shells — its page says how it updates`);
    }
    // An older agent would open a plain shell for a terminal it was asked to keep
    if ((term !== null) && (remote_can(remote, 'term_list') === false)) {
        throw new Error(`the agent on ${name} is from before kept terminals — its page says how it updates`);
    }
    if ((term !== null) && (term_name_valid(term) === false)) {
        throw new Error(`a terminal name is letters, digits, - and _, at most 64 of them: ${JSON.stringify(term)}`);
    }
    const stream = tunnel_open(remote, {shell: ((term === null) ? {cols: 80, rows: 24} : {cols: 80, rows: 24, term})});
    if (term === null) {
        log_event(app, 'shell_begin', {remote: remote.name, container: 'none — the machine itself'});
    }
    else {
        log_event(app, 'shell_begin', {remote: remote.name, container: 'none — the machine itself', term});
    }
    terminal_attach(client, stream, {
        note: ((term === null) ? `a shell on ${remote.name}, as the user its agent runs as` : `the terminal ${term} on ${remote.name}: it keeps running when this page closes`),
        resize: function (size) {
            const promise = remote_call(app, remote, 'shell_resize', {id: stream.id, cols: size.cols, rows: size.rows});
            promise.catch(function () {
                // The link answers or it does not; the terminal keeps its old size either way
            });
        },
        end: log_bind(function () {
            log_event(app, 'shell_end_ok', {remote: remote.name});
        }),
    });
}

module.exports = handle_control_upgrade;
