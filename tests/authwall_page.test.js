const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');

// Authwall is one table of its walls: each a row with its team under its name, what it guards,
// the machine it runs on and how it stands; nothing else under the head
test('Authwall: a row per wall, what it guards, where it runs, how it stands', async function () {
    const page = await page_of({
        apps: {auth: 'authwall'},
        services: [
            service('authwall', {remotes: ['vps1']}),
            service('authwall-family', {title: 'the family', phase: 'stopped', remotes: ['vps1']}),
            service('notes', {type: 'files', auth: 'authwall'}),
        ],
        remotes: [{name: 'vps1', title: 'vps1', inbound: {'grafana.example.com': {service: 'grafana', auth: 'authwall'}, 'shop.example.com': {service: 'shop', auth: 'authwall'}, 'old.example.com': {service: 'docs', auth: 'authwall-old'}, 'docs.example.com': 'docs'}}],
    });
    assert.deepStrictEqual(page.rows.map(v => [v.name, v.line, v.tone, v.guards, v.machine, v.machine_title, v.pill, v.pill_tone, v.service]), [
        ['authwall', 'the wall a fleet starts with', '', 'every app · 2 names', 'vps1', 'vps1', 'running', 'run', true],
        ['authwall-family', 'the family', '', 'nothing yet', 'vps1', 'vps1', 'asleep', 'idle', true],
        ['authwall-old', 'a name asks it; no service is called so', 'bad', '1 name', null, '—', 'no service', 'bad', false],
    ]);
    assert.deepStrictEqual(page.rows.map(v => v.edge), ['', '', 'bad']);
    assert.deepStrictEqual(page.foot.map(v => v.text), ['3 walls', 'an app picks its wall in its Settings, on Apps; a name, in its row on Addresses']);
    assert.deepStrictEqual(page.columns.map(v => v.label), ['Wall', 'Guards', 'Runs on', 'Status']);
    assert.strictEqual(page.base, 'authwall', 'a wall for another team is a copy of authwall');
});

test('Authwall: a failed wall, one starting, one on two machines, one asked by an app alone', async function () {
    const page = await page_of({
        apps: null,
        services: [
            service('authwall-team-b', {title: 'team B', phase: 'failed', remotes: ['laptop']}),
            service('authwall-x', {title: 'x', phase: 'starting', doing: 'starting', remotes: ['vps1']}),
            service('authwall-photos', {title: 'photos', remotes: ['laptop', 'vps1']}),
            service('authwall-here', {type: 'external', remotes: []}),
            service('notes', {type: 'files', auth: 'authwall-team-b'}),
            service('crm', {auth: 'gone'}),
        ],
        remotes: [{name: 'laptop', title: 'Laptop', inbound: {}}, {name: 'vps1', title: '', inbound: {}}],
    });
    assert.deepStrictEqual(page.rows.map(v => [v.name, v.line, v.tone, v.guards, v.machine, v.machine_title, v.pill, v.pill_tone]), [
        ['authwall-here', '', '', 'nothing yet', null, '—', 'answers', 'run'],
        ['authwall-photos', 'photos', '', 'nothing yet', 'laptop', 'Laptop +1', 'running', 'run'],
        ['authwall-team-b', 'team B', '', '1 service', 'laptop', 'Laptop', 'failed', 'bad'],
        ['authwall-x', 'x', '', 'nothing yet', 'vps1', 'vps1', 'starting', 'busy'],
        ['gone', 'an app asks it; no service is called so', 'bad', '1 service', null, '—', 'no service', 'bad'],
    ]);
    assert.deepStrictEqual(page.rows.map(v => v.edge), ['', '', 'bad', '', 'bad'], 'a failed wall and one with no service, a red edge');
    assert.strictEqual(page.base, 'authwall-photos', 'with no authwall, the first wall serviceman runs as a docker image');
});

test('Authwall with no wall: no rows, and nothing to copy', async function () {
    const page = await page_of({apps: null, services: [service('notes', {type: 'files'})], remotes: []});
    assert.deepStrictEqual(page.rows, []);
    assert.deepStrictEqual(page.foot.map(v => v.text), ['0 walls', 'an app picks its wall in its Settings, on Apps; a name, in its row on Addresses']);
    assert.strictEqual(page.base, null);
});

function service(name, more)
{
    return Object.assign({name, title: name, type: 'docker', phase: 'running', doing: null, auth: null, remotes: [], policy: {start: 'on_demand'}, publish: {hosts: []}}, more);
}

// The page's component with its state, its computed values read as fields
async function page_of(state)
{
    const page = (await import(path.join(PUBLIC, 'authwall_pane.js'))).default;
    const out = Object.assign(page.data.call({creating: false}), {state, creating: false, $emit: function () {}});
    for (const [name, method] of Object.entries(page.methods)) {
        out[name] = method.bind(out);
    }
    for (const [name, compute] of Object.entries(page.computed)) {
        Object.defineProperty(out, name, {get: compute.bind(out)});
    }
    return out;
}

// A name's wall is set in its row on Addresses: each door's row knows the wall its own rule names
// and the one its service stands behind everywhere, which comes first and greys the pick
test('Addresses: a door\'s row knows its own wall and its service\'s, and the walls to pick', async function () {
    const page = await addresses_of({
        listen: {port: 3001},
        apps: {auth: null},
        app_ports: {},
        tailnet: null,
        services: [
            service('authwall', {publish: {hosts: [], strip_prefix: false}}),
            service('grafana', {publish: {hosts: [], strip_prefix: false}}),
            service('shop', {auth: 'authwall', publish: {hosts: [], strip_prefix: false}}),
        ],
        remotes: [{name: 'vps1', title: 'vps1', inbound: {'grafana.example.com': {service: 'grafana', auth: 'authwall'}, 'open.example.com': {service: 'grafana'}, 'shop.example.com': {service: 'shop'}}}],
    });
    const doors = page.rows_all.filter(v => v.kind === 'door').map(v => [v.address, v.behind, v.rule_auth, v.service_auth]);
    assert.deepStrictEqual(doors, [
        ['grafana.example.com', 'authwall', 'authwall', null],
        ['open.example.com', null, null, null],
        ['shop.example.com', 'authwall', null, 'authwall'],
    ]);
    assert.deepStrictEqual(page.walls.map(v => v.name), ['authwall']);
});

async function addresses_of(state)
{
    const page = (await import(path.join(PUBLIC, 'addresses_pane.js'))).default;
    const out = Object.assign(page.data(), {state, remote: null, $emit: function () {}});
    for (const [name, method] of Object.entries(page.methods)) {
        out[name] = method.bind(out);
    }
    for (const [name, compute] of Object.entries(page.computed)) {
        Object.defineProperty(out, name, {get: compute.bind(out)});
    }
    return out;
}
