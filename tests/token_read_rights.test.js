const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const control_route_right = require('../src/main/src/helpers/control_route_right');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const module_mount_of = require('../src/main/src/helpers/module_mount_of');
const os = require('os');
const path = require('path');
const profile_from_db = require('../src/main/src/helpers/profile_from_db');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const zip_bytes = require('./fixtures/zip_bytes');

const TOKEN_LAPTOP = 'cccccccccccccccccccccccccccccccc';
const TOKEN_VPS1 = 'dddddddddddddddddddddddddddddddd';
const TOKEN_VPS2 = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

// The author's case: a section of serviceman given read only. Files, the forwards and the apps
// each have a read alone, under the right that reads and writes the same, so a token made
// before the read alone was keeps doing both with the right it has.
test('a read alone is under the right that reads and writes the same, and opens reads alone', function () {
    function right(method, asked) {
        const found = control_route_right(method, asked);
        return (found === null) ? null : [found.right, found.under];
    }
    for (const [method, tail] of [['GET', ''], ['GET', '/'], ['HEAD', '/file/home/user/a.txt'], ['GET', '/file/home/user/a.txt'], ['GET', '/tar'], ['GET', '/watch'], ['GET', '/room']]) {
        assert.deepStrictEqual(right(method, `/api/v1/remotes/vps1/fs${tail}`), ['files_read', 'files'], `${method} fs${tail}`);
    }
    for (const [method, tail] of [['POST', '/upload'], ['POST', '/upload/tar'], ['GET', '/upload/part'], ['POST', '/upload/part'], ['POST', '/upload/finish'], ['POST', '/upload/cancel'], ['POST', '/mkdir'], ['POST', '/rename'], ['POST', '/delete']]) {
        assert.deepStrictEqual(right(method, `/api/v1/remotes/vps1/fs${tail}`), ['files', null], `${method} fs${tail}`);
    }
    assert.strictEqual(right('PUT', '/api/v1/remotes/vps1/fs/anything/at/all'), null, 'what the File Manager does not name is no one\'s but the owner\'s');
    assert.deepStrictEqual(right('GET', '/api/v1/forwards'), ['forwards_read', 'forwards']);
    assert.deepStrictEqual(right('PUT', '/api/v1/forwards'), ['forwards', null]);
    assert.deepStrictEqual(right('GET', '/api/v1/apps'), ['apps_read', 'apps']);
    assert.deepStrictEqual(right('PUT', '/api/v1/apps/notes'), ['apps', null]);
    assert.deepStrictEqual(right('PUT', '/api/v1/apps/notes/socket'), ['apps', null]);

    // Every right a module gives under another opens a read and nothing else
    for (const mount of module_mount_of.MODULE_MOUNTS) {
        const given = [];
        for (const kind of mount.manifest.kinds) {
            given.push([(kind.read === undefined) ? undefined : kind.read.right, ['GET']]);
            for (const command of kind.commands) {
                given.push([command.right, ['POST']]);
            }
        }
        for (const door of mount.manifest.doors) {
            given.push([door.right, door.methods]);
        }
        for (const [item, methods] of given) {
            if ((item !== undefined) && (item.under !== undefined)) {
                assert.deepStrictEqual(methods, ['GET'], `${mount.manifest.module}: ${item.right} opens ${methods.join(', ')}`);
            }
        }
    }
});

test('a token with a read alone reads the forwards of its machines and writes none; one with the forwards right does both, as before', async function (t) {
    const owners = [
        {label: 'loki', from: {remote: 'vps1', port: 3100}, to: {remote: 'laptop', socket: '~/repos/loki.sock'}},
        {label: 'db on vps2', from: {remote: 'vps2', port: 5432}, to: {remote: 'laptop', port: 5432}},
    ];
    const running = await serviceman_start(t, {forwards: owners});
    const looker = await token_make(running, {label: 'a looker', remotes: ['laptop', 'vps1'], rights: ['forwards_read']});
    const writer = await token_make(running, {label: 'a writer', remotes: ['laptop', 'vps1'], rights: ['forwards']});

    const read = await call(running, 'GET', '/api/v1/forwards', null, looker.token);
    assert.strictEqual(read.status, 200, read.body);
    assert.deepStrictEqual(JSON.parse(read.body).forwards, [owners[0]], 'those between its machines alone');
    const write = await call(running, 'PUT', '/api/v1/forwards', {forwards: []}, looker.token);
    assert.deepStrictEqual([write.status, JSON.parse(write.body).error], [403, 'the token "a looker" may not write the forwards']);
    assert.deepStrictEqual(config_kept(running).forwards, owners, 'and the file is as it was');

    // The right made before the read alone was reads and writes
    assert.deepStrictEqual(JSON.parse((await call(running, 'GET', '/api/v1/forwards', null, writer.token)).body).forwards, [owners[0]]);
    const its = {label: 'grafana', from: {remote: 'laptop', port: 3000}, to: {remote: 'vps1', port: 3000}};
    const written = await call(running, 'PUT', '/api/v1/forwards', {forwards: [owners[0], its]}, writer.token);
    assert.strictEqual(written.status, 200, written.body);
    assert.deepStrictEqual(config_kept(running).forwards.map(v => v.label), ['loki', 'grafana', 'db on vps2']);

    // Given the read alone instead, it reads them still, and the forward it asked for is set aside
    const narrowed = await call(running, 'PUT', `/api/v1/tokens/${writer.item.id}`, {label: 'a writer', remotes: ['laptop', 'vps1'], rights: ['forwards_read']}, running.owner);
    assert.deepStrictEqual(JSON.parse(narrowed.body).forwards_set_aside, ['grafana']);
    assert.ok(running.app.log_lines.some(v => /\[forward_set_aside\] forward=grafana token="a writer" reason="its token may no longer write the forwards"/.test(v)));
    assert.strictEqual((await call(running, 'GET', '/api/v1/forwards', null, writer.token)).status, 200);
    assert.strictEqual((await call(running, 'PUT', '/api/v1/forwards', {forwards: []}, writer.token)).status, 403);
});

test('a token with a read alone lists the apps and sends none; one with the apps right does both, as before', async function (t) {
    const running = await serviceman_start(t, {});
    assert.strictEqual((await app_put(running, 'wiki', running.owner)).status, 201);
    const looker = await token_make(running, {label: 'a looker', remotes: [], rights: ['apps_read'], apps_own: true});
    assert.strictEqual(looker.item.apps_own, false, 'kept to the apps it makes is of a token that makes them');

    const listed = await call(running, 'GET', '/api/v1/apps', null, looker.token);
    assert.strictEqual(listed.status, 200, listed.body);
    assert.deepStrictEqual(JSON.parse(listed.body).apps.map(v => v.name), ['wiki']);
    const sent = await app_put(running, 'notes', looker.token);
    assert.deepStrictEqual([sent.status, JSON.parse(sent.body).error], [403, 'the token "a looker" may not send an app of files']);
    const socket = await call(running, 'PUT', '/api/v1/apps/notes/socket', {socket: 'sockets/notes.sock'}, looker.token);
    assert.deepStrictEqual([socket.status, JSON.parse(socket.body).error], [403, 'the token "a looker" may not add an app on a socket']);
    assert.strictEqual(running.app.service_by_name.notes, undefined);

    const sender = await token_make(running, {label: 'a sender', remotes: [], rights: ['apps']});
    assert.strictEqual((await app_put(running, 'notes', sender.token)).status, 201);
    assert.deepStrictEqual(JSON.parse((await call(running, 'GET', '/api/v1/apps', null, sender.token)).body).apps.map(v => v.name), ['wiki', 'notes']);
});

// The files of a machine not connected: a request the token may make goes on to the route and
// hears the machine is away; one it may not is a 403 that says so
test('a token with a read alone is let in to read the files, refused every write, and kept within its folders as the files right is', async function (t) {
    const running = await serviceman_start(t, {});
    const none = await call(running, 'POST', '/api/v1/tokens', {label: 'no folder', remotes: ['vps1'], rights: ['files_read']}, running.owner);
    assert.deepStrictEqual([none.status, JSON.parse(none.body).error], [400, 'the files right, or files_read, is of 1 to 20 folders, such as ~/notes or /srv/data, each one line of up to 500 characters']);
    const looker = await token_make(running, {label: 'a looker', remotes: ['vps1'], rights: ['files_read'], folders: ['~/notes']});
    const writer = await token_make(running, {label: 'a writer', remotes: ['vps1'], rights: ['files'], folders: ['~/notes']});
    assert.deepStrictEqual(looker.item.folders, ['~/notes']);

    for (const [method, tail] of [['GET', '?path=~/notes'], ['GET', '/file/home/user/notes/a.txt'], ['GET', '/tar?dir=~/notes&names=a.txt'], ['GET', '/room']]) {
        const answer = await call(running, method, `/api/v1/remotes/vps1/fs${tail}`, null, looker.token);
        assert.deepStrictEqual([answer.status, JSON.parse(answer.body).error], [409, 'vps1 is not connected'], `${method} fs${tail}`);
    }
    for (const [method, tail] of [['POST', '/upload?dir=~/notes&name=a.txt'], ['POST', '/mkdir'], ['POST', '/rename'], ['POST', '/delete'], ['GET', '/upload/part']]) {
        const answer = await call(running, method, `/api/v1/remotes/vps1/fs${tail}`, null, looker.token);
        assert.deepStrictEqual([answer.status, JSON.parse(answer.body).error], [403, 'the token "a looker" may not write the files'], `${method} fs${tail}`);
        const before = await call(running, method, `/api/v1/remotes/vps1/fs${tail}`, null, writer.token);
        assert.strictEqual(before.status, 409, `the files right writes as it did: ${method} fs${tail}`);
    }
    assert.ok(running.app.log_lines.some(v => /\[control_token_refused\] .*token="a looker" method=POST path=\/api\/v1\/remotes\/vps1\/fs\/mkdir reason="may not write the files"/.test(v)));
});

// The Tokens page gives rights by section: none, read or write for each at once, its rights
// one by one under fine. Its sections are the page's own, held here against the server's.
test('the page\'s sections hold every right once, read the reads alone and say a choice of their rights as it is', async function () {
    const token_sections = (await import('../src/main/public/token_sections.js')).default;
    const token_level_of = (await import('../src/main/public/token_level_of.js')).default;
    const token_section_set = (await import('../src/main/public/token_section_set.js')).default;
    const format_token_section = (await import('../src/main/public/format_token_section.js')).default;
    const named = token_sections.flatMap(v => v.rights);
    assert.deepStrictEqual(named.slice().sort(), control_route_right.RIGHTS.slice().sort(), 'every right serviceman has, each in one section');
    assert.strictEqual(new Set(named).size, named.length);
    const section_by_value = Object.fromEntries(token_sections.map(v => [v.value, v]));
    const {machines, files, terminals, apps, forwards} = section_by_value;
    assert.deepStrictEqual([files.under, apps.under, forwards.under], [{files_read: 'files'}, {apps_read: 'apps'}, {forwards_read: 'forwards'}]);
    assert.deepStrictEqual([control_route_right('GET', '/api/v1/remotes/vps1/fs').under, control_route_right('GET', '/api/v1/apps').under, control_route_right('GET', '/api/v1/forwards').under], ['files', 'apps', 'forwards'], 'as serviceman holds them');
    for (const section of token_sections) {
        for (const item of (section.read === null) ? [] : section.read) {
            assert.ok(['status', 'metrics', 'processes', 'ports', 'disks', 'packages', 'containers', 'vulnerabilities', 'files_read', 'apps_read', 'forwards_read'].includes(item), `${section.label} reads with ${item}, which writes`);
        }
    }
    assert.deepStrictEqual([machines.write, terminals.read], [null, null], 'nothing in Machines writes; a shell is no read');

    // A token made before the read alone was is where its rights put it
    assert.deepStrictEqual(token_sections.map(v => token_level_of(v, ['status', 'metrics', 'files', 'forwards'])), ['fine', 'write', 'none', 'none', 'write']);
    assert.deepStrictEqual(token_sections.map(v => token_level_of(v, ['apps'])), ['none', 'none', 'none', 'fine', 'none'], 'the apps alone, as for serviceman-mcp, is a choice of Apps\'s rights');
    assert.deepStrictEqual(token_sections.map(v => token_level_of(v, machines.read.concat(['files_read', 'apps_read', 'forwards_read']))), ['read', 'read', 'none', 'read', 'read']);
    assert.strictEqual(token_level_of(files, ['files_read', 'files']), 'write', 'a read alone ticked beside its wider right is that right');
    assert.strictEqual(token_level_of(apps, ['apps_read', 'versions']), 'fine');
    assert.strictEqual(token_level_of(terminals, ['terminals']), 'write');

    // Set, a section takes what its level gives, the others stay, and the order is the sections'
    assert.deepStrictEqual(token_section_set(['status', 'files'], files, 'read'), ['status', 'files_read']);
    assert.deepStrictEqual(token_section_set(['forwards', 'status'], apps, 'write'), ['status', 'apps', 'versions', 'forwards']);
    assert.deepStrictEqual(token_section_set(['status', 'metrics'], machines, 'none'), []);
    assert.deepStrictEqual(token_section_set(['status'], machines, 'read'), machines.read);
    assert.throws(() => token_section_set([], terminals, 'read'), /Terminals cannot be set to read/);

    // Said in the token's row: a level, or the rights it has of a section given a choice
    assert.deepStrictEqual(token_sections.map(v => format_token_section(v, ['status', 'metrics', 'files', 'apps', 'forwards_read'])), ['machines: status, metrics', 'files write', '', 'apps: apps', 'forwards read']);
});

test('the form\'s All: read only sets each section to read and Terminals to none; a tick of its own makes a section a choice', async function () {
    const tokens_form = (await import('../src/main/public/tokens_form.js')).default;
    const form = Object.assign(tokens_form.data(), tokens_form.methods);
    form.rights_chosen = ['terminals', 'files', 'apps', 'versions'];
    form.click_all_read_only();
    assert.deepStrictEqual(form.rights_chosen, ['status', 'metrics', 'processes', 'ports', 'disks', 'packages', 'containers', 'vulnerabilities', 'files_read', 'apps_read', 'forwards_read']);
    assert.deepStrictEqual(form.sections.map(v => form.level_of(v)), ['read', 'read', 'none', 'read', 'read']);

    const files = form.sections.find(v => v.value === 'files');
    form.click_level(files, 'write');
    assert.deepStrictEqual([form.level_of(files), form.is_right_held(files, 'files_read'), form.is_right_under(files, 'files_read')], ['write', true, true], 'its read shows ticked, held by files');
    const machines = form.sections.find(v => v.value === 'machines');
    form.change_right('packages');
    assert.deepStrictEqual([form.level_of(machines), form.format_rights_ticked(machines)], ['fine', 'status, metrics, processes, ports, disks, containers, vulnerabilities']);
    form.change_right('packages');
    assert.strictEqual(form.level_of(machines), 'read', 'ticked again, it is read again');

    assert.deepStrictEqual(form.sections_of({rights: ['versions']}), [{value: 'apps', level: 'fine', said: 'apps: versions'}]);
});

// serviceman from a config file in a folder of its own, with three machines; stopped when the test ends
async function serviceman_start(t, config)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-read-rights-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify(Object.assign({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'laptop', token: TOKEN_LAPTOP}, {name: 'vps1', token: TOKEN_VPS1}, {name: 'vps2', token: TOKEN_VPS2}],
        services: [],
    }, config), null, 4));
    const app = app_from_config(await profile_from_db(config_path));
    app.state_dir = path.join(dir, 'data');
    const servers = await server_start(app);
    t.after(function () {
        for (const door of [servers.server, servers.control]) {
            door.close();
            door.closeAllConnections();
        }
    });
    return {app, config_path, control: servers.control.address().port, owner: fetch_host.OWNER_TOKEN};
}

async function token_make(running, body)
{
    const answer = await call(running, 'POST', '/api/v1/tokens', body, running.owner);
    assert.strictEqual(answer.status, 200, answer.body);
    return JSON.parse(answer.body);
}

function call(running, method, asked, body, token)
{
    return fetch_host({port: running.control, method, path: asked, token, body: (body === null) ? undefined : JSON.stringify(body)});
}

// An app of one page, sent with the token given
function app_put(running, name, token)
{
    const body = zip_bytes([{name: 'index.html', bytes: Buffer.from(`<title>${name}</title>`)}]);
    return fetch_host({port: running.control, method: 'PUT', path: `/api/v1/apps/${name}`, body, token});
}

function config_kept(running)
{
    return JSON.parse(fs.readFileSync(running.config_path, 'utf8'));
}
