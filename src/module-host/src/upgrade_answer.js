const docker_exec_connect = require('../../main/src/helpers/docker_exec_connect');
const docker_exec_open = require('../../main/src/helpers/docker_exec_open');
const docker_exec_resize = require('../../main/src/helpers/docker_exec_resize');
const machine_host = require('./machine_host');
const remote_call = require('../../main/src/helpers/remote_call');
const request_allowed = require('./request_allowed');
const streams_of = require('../../main/src/helpers/streams_of');
const terminal_attach = require('../../../modules/terminal/server/terminal_attach');
const tunnel_open = require('../../main/src/helpers/tunnel_open');
const ws = require('ws');

const RE_STREAM = /^\/api\/v1\/streams\/([^/]+)$/;
const RE_CONTAINER = /^[0-9a-f]{12,64}$/;

const sockets = new ws.WebSocketServer({noServer: true});

// The WebSockets of the page, joined to a terminal by the Terminal module as serviceman joins
// them: a kept terminal of this computer, at the address its join answered (once, within a
// minute), and a shell in a container the Docker tab picked.
//
// WS /api/v1/streams/<id>
// WS /api/shell (query: container)
function upgrade_answer(req, socket, head)
{
    const url = new URL(req.url, 'http://module-host.invalid');
    const stream_asked = RE_STREAM.exec(url.pathname);
    const container = url.searchParams.get('container');
    const known = (stream_asked !== null) || ((url.pathname === '/api/shell') && RE_CONTAINER.test(String(container)));
    // A WebSocket carries the Origin of the page that opened it, as a change does
    if ((known === false) || (request_allowed({method: 'POST', url: req.url, headers: req.headers}) === false)) {
        socket.destroy();
        return;
    }
    sockets.handleUpgrade(req, socket, head, function (client) {
        const promise = (stream_asked === null) ? container_join(client, container) : term_join(client, stream_asked[1]);
        promise.catch(function (error) {
            client.send(JSON.stringify({type: 'note', text: error.message, ok: false}));
            client.close();
        });
    });
}

// A kept terminal: its stream is taken once, and the pty at the agent's end is joined to the pane
async function term_join(client, id)
{
    const {app, remote} = machine_host();
    const stream = streams_of(app).get(id);
    if ((stream === undefined) || (stream.kind !== 'both')) {
        throw new Error('this terminal was joined already, or not within a minute: open it again');
    }
    const join = stream.take();
    if (remote.state.phase !== 'online') {
        throw new Error('the agent is starting; open it again in a moment');
    }
    const tunnel = tunnel_open(remote, {shell: {cols: 80, rows: 24, term: join.term}});
    terminal_attach(client, tunnel, {
        note: `the terminal ${join.term} on this computer: it keeps running when this page closes`,
        resize: function (size) {
            remote_call(app, remote, 'shell_resize', {id: tunnel.id, cols: size.cols, rows: size.rows}).catch(function () {
                // The terminal keeps its old size
            });
        },
        end: function () {
            // A kept terminal stays as it is
        },
    });
}

// A shell in a container of this computer: docker exec through the engine's socket
async function container_join(client, container)
{
    const {app, remote} = machine_host();
    if (remote.state.phase !== 'online') {
        throw new Error('the agent is starting; open it again in a moment');
    }
    const connect = docker_exec_connect(app, remote);
    const exec = await docker_exec_open(connect, container, {cols: 80, rows: 24});
    terminal_attach(client, exec.stream, {
        note: `a shell in container ${container.slice(0, 12)} on this computer`,
        resize: function (size) {
            docker_exec_resize(connect, exec.id, size);
        },
        end: function () {
            // The shell ends with its pane
        },
    });
}

module.exports = upgrade_answer;
