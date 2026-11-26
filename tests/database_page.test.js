const assert = require('assert');
const test = require('node:test');

// A database's page as the design draws it, read through its own computed parts: who Give it to
// an app offers it to and why not the others, what How an app reaches it says (a URL breaking only
// after its @ and before its /<database>), a CouchDB's store apps among Given to, what Remove says,
// and the steps of one coming up.
test('a database\'s page offers it to the apps that reach it, and says each part as drawn', async function () {
    const pane = (await import('../src/main/public/databases_pane.js')).default;
    const engines = [
        {value: 'mongodb', label: 'MongoDB', port: 27017, scheme: 'mongodb', versions: ['8.0'], samples: []},
        {value: 'couchdb', label: 'CouchDB', port: 5984, scheme: 'http', versions: ['3'], samples: []},
        {value: 'postgresql', label: 'PostgreSQL', port: 5432, scheme: 'postgresql', versions: ['17'], samples: [{value: 'sakila', label: 'Sakila'}]},
    ];
    const server = {name: 'mongodb-1', engine: 'mongodb', version: '8.0', sample: '', remote: 'vps1', title: 'vps1', online: true, phase: 'up', said: '', error: null, port: 41337, read_at: null, stores: [],
        forwards: [{label: 'mongodb-1 → vps2', to: {remote: 'vps2', here: false, port: 27018, socket: null, host: null}, off: false, tls: false, allow: []}],
        databases: [
            {name: 'orders', bytes: 1024, tables: 3, apps: ['shop'], envs: {shop: 'MONGODB_URL'}, user: 'orders'},
            {name: 'orders_test', bytes: 2048, tables: 0, apps: [], envs: {}, user: 'orders_test'},
        ]};
    const services = [
        service('shop', 'shell', 'vps2', 'machine'),
        service('thumbs', 'shell', 'vps2', 'machine'),
        service('box', 'docker', 'vps2', 'container'),
        service('reports', 'docker', 'vps1', 'container'),
        service('mail', 'shell', 'laptop', 'machine'),
        Object.assign(service('docs', 'files', '', null), {remotes: []}),
        Object.assign(service('wiki', 'external', '', null), {remotes: []}),
    ];
    const vm = vm_of(pane, {view: {engines, machines: [{remote: 'vps1', title: 'vps1', online: true}, {remote: 'vps2', title: 'vps2', online: true}], servers: [server]}, state: {services}, place: {page: 'database', server: 'mongodb-1', database: 'orders'}});

    // Give it to an app: those that reach it to tick, the others saying why not
    assert.deepStrictEqual(vm.give_cards.map(v => `${v.name}: ${v.disabled ? v.why : 'tick'} ${v.env}`), [
        'thumbs: tick MONGODB_URL',
        'reports: tick MONGODB_URL',
        'shop: has it already MONGODB_URL',
        'box: on vps2, in a container: a forward there is out of its reach MONGODB_URL',
        'mail: on laptop: its port is not brought there; + a machine under Reached from brings it MONGODB_URL',
        'docs: a page: nothing serviceman starts MONGODB_URL',
        'wiki: already running elsewhere: nothing serviceman starts MONGODB_URL',
    ]);
    server.forwards[0].off = true;
    assert.strictEqual(vm.give_cards.find(v => v.name === 'thumbs').why, 'on vps2: its forward there is set aside');
    server.forwards[0].off = false;
    vm.giving = {picked: ['thumbs', 'reports'], busy: false, error: ''};
    assert.deepStrictEqual([vm.give_said, vm.give_button], ['thumbs, reports have it from their next start', 'Give it to 2 apps']);

    // Given to, a row an app with its kind, its machine and how it stands
    assert.deepStrictEqual(vm.given_rows.map(v => `${v.name} · ${v.line} · ${v.codes.join(' and ')} · ${v.word} ${v.tone}`), ['shop · App folder · vps2 · MONGODB_URL · running run']);
    assert.strictEqual(vm.given_foot, '1 app · it finds it at its every start');

    // How an app reaches it: a URL breaks only after its @ and before its /<database>
    const rows = Object.fromEntries(vm.reach_rows.map(v => [v.label, v.html]));
    assert.strictEqual(rows['From a container'], '<code><span class="db-nw">mongodb://orders:••••••••@</span><wbr><span class="db-nw">serviceman-db-mongodb-1:27017</span><wbr><span class="db-nw">/orders</span></code>');
    assert.strictEqual(rows['From vps1 itself'], '<code><span class="db-nw">mongodb://orders:••••••••@</span><wbr><span class="db-nw">127.0.0.1:41337</span><wbr><span class="db-nw">/orders</span></code>');
    assert.deepStrictEqual([rows['Its user'], rows['Its data']], ['<code>orders</code> · on this database alone', '<code>serviceman-db-mongodb-1</code> volume, at <code>/data/db</code>']);
    assert.strictEqual(vm.remove_said, 'Removes its server, mongodb-1, and orders_test with it: its container on vps1 stops and their data goes; shop finds no database at its next start.');
    assert.deepStrictEqual(vm.remove_rows.map(v => `${v.label}: ${v.code}${v.text}`), ['Its container: serviceman-db-mongodb-1 stops and goes', 'Its data: serviceman-db-mongodb-1 volume, 1 KB, goes for good', 'Beside it: orders_test', 'Apps given it: shop: no database at the next start']);

    // Its machine away: Remove waits for it, the apps find it again when it is back
    server.online = false;
    assert.strictEqual(vm.given_foot, '1 app · it finds the database again when vps1 is back');
    assert.match(vm.remove_said, /^Removes its server, mongodb-1, and orders_test with it, once vps1 is back: its container stops/);
    server.online = true;

    // A CouchDB: its admin with its secret, and the apps whose store it is, finding it at /_couch
    Object.assign(server, {engine: 'couchdb', version: '3', stores: ['docs', 'shop']});
    server.databases[0].envs = {shop: 'COUCHDB_URL'};
    assert.deepStrictEqual(vm.given_rows.map(v => `${v.name}: ${v.codes.join(' and ')}${v.after}`), ['shop: COUCHDB_URL and COUCHDB_SECRET', 'docs: /_couch a store for each user']);
    assert.strictEqual(vm.given_foot, '2 apps · every user its wall signs in has a database of their own');
    assert.strictEqual(vm.reach_rows[0].html, '<code>COUCHDB_URL</code> and <code>COUCHDB_SECRET</code> · the secret signs a user\'s name');
    assert.strictEqual(vm.remove_said, 'Removes its server, mongodb-1: every user\'s database goes with it; shop and docs find no store at their next start.');

    // Coming up: the step said now turning, those before it done
    Object.assign(server, {engine: 'postgresql', version: '17', sample: 'sakila', phase: 'starting', said: 'fetching Sakila'});
    assert.deepStrictEqual(vm.up_steps.map(v => `${v.state} ${v.text}`), ['done pulling its image', 'done making its container', 'done waiting for PostgreSQL to answer', 'now fetching Sakila', 'next loading Sakila']);

    // An empty server: its own head line, Remove its container alone
    Object.assign(server, {engine: 'mongodb', version: '8.0', sample: '', phase: 'up', said: '', databases: []});
    vm.place = {page: 'database', server: 'mongodb-1', database: ''};
    assert.strictEqual(vm.server_only, true);
    assert.deepStrictEqual(vm.open_facts.map(v => `${v.label} ${v.value}`), ['Databases 0', 'Reached from 2 machines']);
    assert.strictEqual(vm.remove_said, 'Removes its container and its volume on vps1.');
});

// An app as the status says it: a program on a machine, a container, a page, an address running
function service(name, type, machine, runs_in)
{
    return {name, type, remotes: [machine], runs_in, app_folder: (type === 'shell') && (name === 'shop') ? '/home/user/shop' : null, socket: null, doing: null, phase: 'running', policy: {start: 'on_demand'}};
}

// The pane as the page would have it: its data, its methods bound to it, and its computed parts
// read live, as Vue reads them
function vm_of(pane, fields)
{
    const vm = Object.assign(pane.data(), fields);
    for (const [key, method] of Object.entries(pane.methods)) {
        vm[key] = method.bind(vm);
    }
    for (const [key, computed] of Object.entries(pane.computed)) {
        Object.defineProperty(vm, key, {get: () => computed.call(vm)});
    }
    return vm;
}
