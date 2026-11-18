const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile_from_db = require('../src/main/src/helpers/profile_from_db');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

// An app on a socket passes every visitor of its names into that file, docker's own socket too:
// a token with the apps right puts one on a machine it sees alone, at the socket named after the
// app, and nothing is made of what it is refused; the owner names any file, as before
test('a token puts an app on a socket of its own name on a machine it sees, and nowhere else', async function (t) {
    const running = await serviceman_start(t);
    const laptop = await token_make(running, 'a box on laptop', ['laptop']);
    const none = await token_make(running, 'a box', []);
    const refused = [
        [laptop, 'notes', {socket: '/var/run/docker.sock', remote: 'laptop'}, 'may put notes on a socket at ~/notes.sock alone, not /var/run/docker.sock'],
        [laptop, 'notes', {socket: '~/other.sock', remote: 'laptop'}, 'may put notes on a socket at ~/notes.sock alone, not ~/other.sock'],
        [laptop, 'notes', {socket: '~/notes.sock', remote: 'vps1'}, 'may not put an app on vps1: it sees laptop'],
        [none, 'notes', {socket: '~/notes.sock', remote: 'laptop'}, 'may not put an app on laptop: it sees no machine'],
        [none, 'board', {socket: '/var/run/docker.sock'}, 'may put board on a socket at data/sockets/board.sock alone, not /var/run/docker.sock'],
        [none, 'board', {socket: 'sockets/other.sock'}, 'may put board on a socket at data/sockets/board.sock alone, not sockets/other.sock'],
        [none, 'board', {socket: '../serviceman.sock'}, 'not ../serviceman.sock'],
    ];
    for (const [token, name, body, said] of refused) {
        const answer = await socket_put(running, token, name, body);
        assert.strictEqual(answer.status, 403, `${JSON.stringify(body)}: ${answer.body}`);
        assert.ok(JSON.parse(answer.body).error.includes(said), answer.body);
        assert.strictEqual(running.app.service_by_name[name], undefined, `${JSON.stringify(body)}: nothing made`);
    }

    // Its own name's socket, on a machine it sees or on serviceman's side, written either way
    assert.strictEqual((await socket_put(running, laptop, 'notes', {socket: '~/notes.sock', remote: 'laptop'})).status, 201);
    assert.strictEqual(running.app.service_by_name.notes.upstream.socket, '~/notes.sock');
    assert.strictEqual((await socket_put(running, none, 'board', {socket: 'data/sockets/board.sock'})).status, 201);
    assert.strictEqual((await socket_put(running, none, 'board', {socket: path.join(running.app.state_dir, 'sockets', 'board.sock')})).status, 200, 'the same file, written whole');
    // A token that sees every machine sees vps1 too
    const every = await token_make(running, 'a box everywhere', ['*']);
    assert.strictEqual((await socket_put(running, every, 'wiki', {socket: '~/wiki.sock', remote: 'vps1'})).status, 201);

    // The owner names any file, on any machine
    assert.strictEqual((await socket_put(running, undefined, 'docker', {socket: '/var/run/docker.sock', remote: 'vps1'})).status, 201);
});

async function socket_put(running, token, name, body)
{
    return await fetch_host({port: running.control, method: 'PUT', path: `/api/v1/apps/${name}/socket`, body: JSON.stringify(body), token});
}

async function serviceman_start(t)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-socket-token-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'laptop', token: 'a-token-of-laptop-0123456789'}, {name: 'vps1', token: 'a-token-of-vps1-0123456789ab'}],
        services: [],
    }, null, 4));
    const app = app_from_config(await profile_from_db(config_path));
    app.state_dir = path.join(dir, 'data');
    const servers = await server_start(app);
    t.after(function () {
        for (const door of [servers.server, servers.control]) {
            door.close();
            door.closeAllConnections();
        }
        fs.rmSync(dir, {recursive: true, force: true});
    });
    return {app, dir, port: servers.server.address().port, control: servers.control.address().port};
}

// A token made by the owner as the Tokens page makes one, the right apps alone: its value
async function token_make(running, label, remotes)
{
    const answer = await fetch_host({port: running.control, method: 'POST', path: '/api/v1/tokens', body: JSON.stringify({label, remotes, rights: ['apps']})});
    assert.strictEqual(answer.status, 200, answer.body);
    return JSON.parse(answer.body).token;
}
