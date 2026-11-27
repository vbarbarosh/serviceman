const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
const VPS1 = {name: 'vps1', title: 'Hetzner, Falkenstein', token: '0123456789abcdef0123456789abcdef', logs: 'all', log_dirs: [{path: '/var/log/nginx/*.log', service: 'nginx'}], inbound: {ssh: true}};

// What names a machine, and so keeps its name and keeps it from being removed: a service on it,
// alone or among others, a forward or a mount at either end, a board, a load test; a service
// asking for a tag, or on another machine, does not
test('what in the config names a machine: services, forwards, mounts, boards, load tests', async function () {
    const remote_named_by = (await import(path.join(PUBLIC, 'remote_named_by.js'))).default;
    const json = {
        services: [
            {name: 'authwall', remote: 'vps1'},
            {name: 'notes', remotes: ['vps2', 'vps1']},
            {name: 'shop', remotes: 'vps1'},
            {name: 'gpu-job', remotes: ['#gpu']},
            {name: 'far', remote: 'vps2'},
        ],
        forwards: [{label: 'mongodb-1 → vps1', from: {remote: 'vps2', port: 27017}, to: {remote: 'vps1', port: 27018}}, {from: {remote: 'vps2'}, to: {remote: 'laptop'}}],
        mounts: [{label: 'photos', from: {remote: 'vps1', path: '/srv'}, to: {remote: 'laptop', path: '/mnt'}}],
        boards: [{name: 'ops', machines: ['vps1', 'vps2']}, {name: 'home', machines: 'laptop'}],
        load_tests: [{name: 'shop-500', remote: 'vps1', service: 'shop'}],
    };
    assert.deepStrictEqual(remote_named_by(json, 'vps1'), [
        {kind: 'service', name: 'authwall'},
        {kind: 'service', name: 'notes'},
        {kind: 'service', name: 'shop'},
        {kind: 'forward', name: 'mongodb-1 → vps1'},
        {kind: 'mount', name: 'photos'},
        {kind: 'board', name: 'ops'},
        {kind: 'load test', name: 'shop-500'},
    ]);
    assert.deepStrictEqual(remote_named_by({}, 'vps1'), []);
    assert.deepStrictEqual(remote_named_by({services: [{name: 'x', remote: 'vps1'}]}, 'vps9'), []);
});

// A machine's Settings is a card a setting, each saved alone: Title writes the entry with its
// title alone changed, its logs, log folders and door kept; Drawn as writes the Canvas alone; a new
// token is said before it is saved; a name the services still use is not saved at all, and says
// why; Cancel puts the card back as it was
test('a machine\'s Settings: each card says its change and what Save does, and saves it alone', async function () {
    const form = await form_of();

    const title = form_self(form, VPS1, []);
    title.card_open('title');
    assert.deepStrictEqual([title.changes, title.save_ok, title.foot.text], [[], false, '']);
    title.model.title = 'Hetzner, Falkenstein, rack 2';
    assert.deepStrictEqual(title.changes, ['Hetzner, Falkenstein → Hetzner, Falkenstein, rack 2']);
    assert.deepStrictEqual([title.save_ok, title.foot], [true, {text: 'Only how this page and the Canvas name it: nothing restarts.', bad: false}]);
    const written = await saved(() => title.card_save());
    assert.deepStrictEqual(written, [{url: '/api/v1/remotes/vps1', method: 'PUT', body: {remote: Object.assign({}, VPS1, {title: 'Hetzner, Falkenstein, rack 2'})}}]);

    const kind = form_self(form, VPS1, []);
    kind.kind = 'server';
    kind.card_open('kind');
    kind.kind_pick = 'laptop';
    assert.deepStrictEqual([kind.changes, kind.foot.text], [['a server → a laptop'], 'Only how the Canvas draws it: nothing restarts.']);
    assert.deepStrictEqual(await saved(() => kind.card_save()), [{url: '/api/v1/canvas/machines/vps1', method: 'PUT', body: {kind: 'laptop'}}]);
    assert.deepStrictEqual([kind.kind, kind.open], ['laptop', '']);

    const access = form_self(form, VPS1, []);
    access.access_another();
    assert.deepStrictEqual([access.open, access.changes, access.save_ok], ['access', ['a new token'], true]);
    assert.match(access.model.token, /^[0-9a-f]{64}$/);
    assert.strictEqual(access.foot.text, 'Its agent keeps the old token: once this is saved, vps1 cannot dial in until it is given the new one, with the line its Install tab has.');
    access.card_cancel();
    assert.deepStrictEqual([access.open, access.model.token], ['', VPS1.token]);

    const named = form_self(form, VPS1, [{kind: 'service', name: 'authwall'}, {kind: 'service', name: 'uptime-kuma'}]);
    named.card_open('name');
    named.model.name = 'vps-new';
    assert.deepStrictEqual([named.changes, named.save_ok, named.foot], [['vps1 → vps-new'], false, {text: 'Not while authwall and uptime-kuma run on it: a new name waits until they move.', bad: true}]);
    assert.deepStrictEqual(await saved(() => named.card_save()), []);
    named.model.name = 'Bad Name';
    assert.deepStrictEqual(named.foot, {text: 'Lowercase letters, digits, - and _ only, starting with a letter or a digit.', bad: true});

    const free = form_self(form, VPS1, []);
    free.card_open('name');
    free.model.name = 'vps-new';
    assert.deepStrictEqual([free.save_ok, free.foot.text], [true, 'Renames it here; its agent dials in again as vps-new. Nothing restarts.']);
    assert.deepStrictEqual(await saved(() => free.card_save()), [{url: '/api/v1/remotes/vps1', method: 'PUT', body: {remote: Object.assign({}, VPS1, {name: 'vps-new'})}}]);
});

// The form's own code, its imports the ones these cards use
async function form_of()
{
    const text = fs.readFileSync(path.join(PUBLIC, 'remote_form.js'), 'utf8');
    const kept = ['./entry_from_form.js'];
    const names = [];
    const values = [];
    for (const [, name, from] of text.matchAll(/^import (\w+) from '([^']+)';$/gm)) {
        names.push(name);
        values.push(kept.includes(from) ? (await import(path.join(PUBLIC, from))).default : undefined);
    }
    const body = text.replace(/^import .*$/gm, '').replace(/^export default (\w+);$/m, 'return $1;');
    return new Function(...names, `'use strict';\n${body}`)(...values);
}

// The form for `original` as its page gives it, its computed parts read as Vue reads them;
// $emit, $nextTick and $el do nothing here
function form_self(form, original, named_by)
{
    const props = {original, control: null, tailnet: null, named_by};
    const self = Object.assign({}, form.methods, form.data.call(props), props, {$emit: function () {}, $nextTick: function () {}});
    for (const [key, computed] of Object.entries(form.computed)) {
        Object.defineProperty(self, key, {get: () => computed.call(self)});
    }
    form.created.call(self);
    return self;
}

// What `run` asks of serviceman: each request's address, method and body, answered with a yes
async function saved(run)
{
    const before = global.fetch;
    const out = [];
    global.fetch = async function (url, options) {
        out.push({url, method: options.method, body: JSON.parse(options.body)});
        return {ok: true, json: () => Promise.resolve({})};
    };
    try {
        await run();
    }
    finally {
        global.fetch = before;
    }
    return out;
}
