const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
const TOKEN = '0123456789abcdef0123456789abcdef';

// The service of SM-261 and the machine of SM-262, as the config file had them
const WHOAMI = {name: 'whoami', type: 'docker', remote: 'laptop', publish: {host: 'whoami.localhost', port: 80}, image: 'demo/whoami', run_args: ['--memory', '256m'], args: ['--verbose']};
const DESKTOP = {name: 'desktop', token: TOKEN.replace('0', '1'), tags: ['gpu'], log_dirs: [{path: '/var/log/nginx/*.log', service: 'nginx'}]};

// One entry of each kind holding every key the validator takes of it (config_from_json,
// remotes_from_json) and a key written by hand, spelled as a person may spell them: a list of
// one machine, a storage line as an object, a number in the environment
const FULL = {
    name: 'full',
    title: 'Everything',
    type: 'docker',
    remotes: ['laptop'],
    publish: {hosts: ['full.localhost/app'], port: 8080, strip_prefix: true},
    redirect: 'http://localhost:8090',
    image: 'demo/full:1',
    env: {MODE: 'prod', WORKERS: 4},
    volumes: [{source: '/srv/full', target: '/data', readonly: true, create: false}, 'cache:/cache'],
    network: 'backend',
    init: false,
    run_args: ['--memory', '512m', '--device', '/dev/dri'],
    args: ['--verbose', '--port', '8080'],
    policy: {
        start: 'on_demand',
        stop_after_idle: '30m',
        start_timeout: '90s',
        stop_timeout: '20s',
        start_tries: 3,
        request_timeout: '2m',
        scale_down_after: '5m',
        instances: {min: 1, max: 3},
        restart: 'always',
        concurrency: 4,
        prepull: false,
        autoscale: {busy_up: 0.8, busy_down: 0.3, up_for: '20s', down_for: '3m', cool_down: '2m'},
        warmup: {queue: 2, wait: '3s'},
    },
    note: 'kept by hand',
};
const PROG = {
    name: 'prog',
    type: 'shell',
    remote: 'laptop',
    publish: {host: 'prog.localhost', port: 3000},
    argv: ['node', 'src/http.js', '--quiet'],
    image: 'node:24-alpine',
    user: 'node:node',
    volumes: [':/app/data'],
    lifecycle: {install: 'npm ci', update: 'git pull && npm ci', stop: 'bin/flush', uninstall: 'rm -rf cache'},
    cwd: '/srv/prog',
    env: {NODE_ENV: 'production'},
    policy: {
        stop_after_idle: '15m',
        start_timeout: '45s',
        stop_timeout: '8s',
        start_tries: 4,
        request_timeout: false,
        scale_down_after: '4m',
        instances: {min: 0, max: 1},
        restart: 'never',
        concurrency: 8,
        prepull: false,
        warmup: {queue: 3, wait: '5s'},
    },
};
const FAR = {name: 'far', title: 'Far away', type: 'external', remote: 'laptop', publish: {host: 'far.localhost'}, upstream: '127.0.0.1:7000', policy: {request_timeout: '5m', concurrency: 2}};
const LAPTOP = {
    name: 'laptop',
    title: 'Laptop',
    token: TOKEN,
    tags: ['gpu', 'eu'],
    machine: 'm-1234',
    inbound: {'who.example.com': 'whoami', 'full.example.com': {service: 'full', off: true, auth: 'far'}},
    logs: 'all',
    log_dirs: [{path: '/var/log/nginx/*.log', service: 'nginx'}, {path: '~/app/logs'}],
    note: 'kept by hand',
};

test('a form\'s entry is the file\'s own, changed only where what the form writes changed', async function () {
    const entry_from_form = (await import(path.join(PUBLIC, 'entry_from_form.js'))).default;
    const original = entry_freeze({name: 'a', one: {x: 1, hand: true}, list: [{path: '/a', more: 1}, '/b'], gone: 'soon', twin_long: ['m'], hand: 'kept'});
    const seen = entry_freeze({name: 'a', one: {x: 1}, list: ['/a', '/b'], gone: 'soon', twin: 'm'});

    // Nothing changed in the form: the entry is the file's, spelled as the file spells it
    assert.deepStrictEqual(entry_from_form(original, seen, seen, {}), original);

    // In both and another, new, in `seen` alone, in neither; a new key goes after the key the
    // form writes before it, and nothing else moves
    const written = entry_freeze({name: 'b', title: 'B', one: {x: 1}, list: ['/a', '/b'], twin: 'm'});
    assert.strictEqual(JSON.stringify(entry_from_form(original, seen, written, {})), JSON.stringify({name: 'b', title: 'B', one: {x: 1, hand: true}, list: [{path: '/a', more: 1}, '/b'], twin_long: ['m'], hand: 'kept'}));

    // One value is written whole; an object the shape names is changed key by key, and goes
    // when the form emptied it and nothing else is in it
    const other = entry_freeze(Object.assign({}, seen, {one: {x: 2}}));
    assert.deepStrictEqual(entry_from_form(original, seen, other, {}).one, {x: 2});
    assert.deepStrictEqual(entry_from_form(original, seen, other, {one: {}}).one, {x: 2, hand: true});
    const emptied = entry_freeze(entry_omit(seen, 'one'));
    assert.strictEqual(entry_from_form(original, seen, emptied, {}).one, undefined);
    assert.deepStrictEqual(entry_from_form(original, seen, emptied, {one: {}}).one, {hand: true});
    assert.strictEqual(entry_from_form(entry_freeze({one: {x: 1}}), entry_freeze({one: {x: 1}}), {}, {one: {}}).one, undefined);

    // In a list, an item the form left as it was stays as the file spells it
    const longer = entry_freeze(Object.assign({}, seen, {list: ['/c', '/a']}));
    assert.deepStrictEqual(entry_from_form(original, seen, longer, {}).list, ['/c', {path: '/a', more: 1}]);

    // Two keys that say one thing: the one the form writes or empties takes the other with it
    const twins = {twin: 'twin_long', twin_long: 'twin'};
    assert.deepStrictEqual(entry_from_form(original, seen, seen, twins).twin_long, ['m']);
    const moved = entry_from_form(original, seen, entry_freeze(Object.assign({}, seen, {twin: 'n'})), twins);
    assert.deepStrictEqual([moved.twin, moved.twin_long], ['n', undefined]);
    const listed = entry_from_form(original, seen, entry_freeze(Object.assign(entry_omit(seen, 'twin'), {twin_long: ['m', 'n']})), twins);
    assert.deepStrictEqual([listed.twin, listed.twin_long], [undefined, ['m', 'n']]);
    const untwinned = entry_from_form(original, seen, entry_freeze(entry_omit(seen, 'twin')), twins);
    assert.deepStrictEqual([untwinned.twin, untwinned.twin_long], [undefined, undefined]);
});

// SM-261, as the page's own code sends it: the Name card of the note's service, a new Title, Save
test('a card\'s Save of a service keeps run_args, args and argv, and the page shows what it sends', async function () {
    const saved = await service_save(WHOAMI, v => Object.assign(v, {title: 'Who am I really'}));
    const expected = {name: 'whoami', title: 'Who am I really', type: 'docker', remote: 'laptop', publish: {host: 'whoami.localhost', port: 80}, image: 'demo/whoami', run_args: ['--memory', '256m'], args: ['--verbose']};
    assert.strictEqual(JSON.stringify(saved.sent), JSON.stringify(expected), 'the new title under the name, and the rest as the file has it');
    assert.deepStrictEqual(saved.shown, saved.sent, 'the page shows what Save writes');

    // Every key the validator takes, and one written by hand: a Save that changes nothing sends
    // the entry as the file has it, key for key in the file's order, and a new title changes
    // the title alone
    for (const entry of [FULL, PROG, FAR]) {
        const same = await service_save(entry, v => v);
        assert.strictEqual(JSON.stringify(same.sent), JSON.stringify(entry), entry.name);
        assert.deepStrictEqual(same.shown, same.sent, entry.name);
        const titled = await service_save(entry, v => Object.assign(v, {title: 'Renamed'}));
        assert.deepStrictEqual(titled.sent, Object.assign({}, entry, {title: 'Renamed'}), entry.name);
    }

    // A clone is a new service with the settings carried over, those no card shows among them
    const clone = await service_save(null, v => Object.assign(v, {name: 'whoami-2', hosts: [{key: 1, text: 'whoami-2.localhost'}]}), WHOAMI);
    assert.deepStrictEqual(clone.sent, Object.assign({}, WHOAMI, {name: 'whoami-2', publish: {host: 'whoami-2.localhost', port: 80}}));
});

test('what was taken out in a card goes from the file, and what no card shows neither comes back nor goes with it', async function () {
    // The environment emptied, one variable of two taken away, the title cleared
    assert.deepStrictEqual((await service_save(FULL, v => Object.assign(v, {env: []}))).sent, entry_omit(FULL, 'env'));
    assert.deepStrictEqual((await service_save(FULL, v => v.env.pop())).sent, Object.assign({}, FULL, {env: {MODE: 'prod'}}));
    assert.deepStrictEqual((await service_save(FULL, v => Object.assign(v, {title: ''}))).sent, entry_omit(FULL, 'title'));

    // An address added where the file had a list of one: a list, and no `host` beside it. A
    // machine changed where the file had a list of one: `remote`, and no `remotes` beside it.
    const addressed = (await service_save(FULL, v => v.hosts.push({key: 1, text: 'full.example.com'}))).sent;
    assert.deepStrictEqual(addressed.publish, {hosts: ['full.localhost/app', 'full.example.com'], port: 8080, strip_prefix: true});
    const placed = (await service_save(WHOAMI, v => Object.assign(v, {places: [{key: 1, text: 'desktop'}, {key: 2, text: 'laptop'}]}))).sent;
    assert.deepStrictEqual([placed.remote, placed.remotes], [undefined, ['desktop', 'laptop']]);
    const moved = (await service_save(FULL, v => Object.assign(v, {places: [{key: 1, text: 'desktop'}]}))).sent;
    assert.deepStrictEqual([moved.remote, moved.remotes], ['desktop', undefined]);

    // A kept path added: the line beside it stays as the file spells it, `create` and all
    const kept = (await service_save(FULL, v => v.volumes.push({key: 1, source: '', target: '/logs', readonly: false}))).sent;
    assert.deepStrictEqual(kept.volumes, [FULL.volumes[0], 'cache:/cache', ':/logs']);

    // Follow the load unticked: `autoscale` goes whole, and the rest of the policy stays
    const steady = (await service_save(FULL, v => Object.assign(v, {autoscale: false}))).sent;
    assert.deepStrictEqual(steady, Object.assign({}, FULL, {policy: entry_omit(FULL.policy, 'autoscale')}));

    // A program's port and address taken away: it starts with serviceman, and the policy keys
    // a program's cards never write stay
    const quiet = (await service_save(PROG, v => Object.assign(v, {port: '', hosts: [{key: 1, text: ''}]}))).sent;
    assert.deepStrictEqual(quiet, Object.assign({}, PROG, {publish: {}, policy: Object.assign({start: 'always'}, PROG.policy)}));

    // A line typed into the Command box takes the place of `argv`, which would win over it
    const typed = (await service_save(PROG, v => Object.assign(v, {command: 'node src/http.js'}))).sent;
    assert.deepStrictEqual(typed, Object.assign(entry_omit(PROG, 'argv'), {command: 'node src/http.js'}));
});

test('a service made another kind loses what the kind it was alone reads', async function () {
    // An image made a program: `run_args` and `args` go with `network` and `init`, and so do
    // the copies a program cannot have; what both kinds read stays
    const program = (await service_save(FULL, v => Object.assign(v, {type: 'shell', command: 'node server.js'}))).sent;
    assert.deepStrictEqual(program, Object.assign(entry_omit(FULL, 'network', 'init', 'run_args', 'args'), {
        type: 'shell',
        command: 'node server.js',
        policy: {start: 'on_demand', stop_after_idle: '30m', start_timeout: '90s', stop_timeout: '20s', start_tries: 3, request_timeout: '2m', restart: 'always'},
    }));

    // A program made an image: `argv` goes with `command`, `lifecycle`, `cwd` and `user`
    const image = (await service_save(PROG, v => Object.assign(v, {type: 'docker'}))).sent;
    assert.deepStrictEqual(image, Object.assign(entry_omit(PROG, 'argv', 'user', 'lifecycle', 'cwd'), {type: 'docker'}));

    // Made something already running: what ran it goes, the address and the machine stay
    const external = (await service_save(WHOAMI, v => Object.assign(v, {type: 'external', upstream: '127.0.0.1:7000'}))).sent;
    assert.deepStrictEqual(external, {name: 'whoami', type: 'external', remote: 'laptop', publish: {host: 'whoami.localhost'}, upstream: '127.0.0.1:7000'});
});

// SM-262, as the page's own code sends it: a machine's Settings, a new Title, Save
test('a Save of a machine\'s Settings keeps its log folders', async function () {
    const titled = await remote_save(DESKTOP, v => Object.assign(v, {title: 'Desktop'}));
    assert.strictEqual(JSON.stringify(titled), JSON.stringify({name: 'desktop', title: 'Desktop', token: DESKTOP.token, tags: ['gpu'], log_dirs: DESKTOP.log_dirs}));

    // Every key the validator takes, and one written by hand: unchanged, and a tag taken away
    assert.strictEqual(JSON.stringify(await remote_save(LAPTOP, v => v)), JSON.stringify(LAPTOP));
    assert.deepStrictEqual(await remote_save(LAPTOP, v => Object.assign(v, {tags: 'gpu'})), Object.assign({}, LAPTOP, {tags: ['gpu']}));
    assert.deepStrictEqual(await remote_save(LAPTOP, v => Object.assign(v, {tags: '', title: ''})), entry_omit(LAPTOP, 'tags', 'title'));
});

test('through the control door, a Save of either form leaves the file as it was but for the field changed', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-entry-'));
    const config_path = path.join(dir, 'serviceman.json');
    const json = {listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: [LAPTOP, DESKTOP], services: [WHOAMI, FULL, PROG, FAR]};
    fs.writeFileSync(config_path, JSON.stringify(json, null, 4));
    const config = config_from_json(json, dir);
    config.path = config_path;
    const app = app_from_config(config);
    app.state_dir = dir;
    const servers = await server_start(app);
    const port = servers.control.address().port;
    function file_read() {
        return JSON.parse(fs.readFileSync(config_path, 'utf8'));
    }
    try {
        // A Save that changes nothing: the whole file is as it was
        for (const entry of [WHOAMI, FULL, PROG, FAR]) {
            assert.strictEqual((await service_save(entry, v => v, undefined, port)).note, '', entry.name);
        }
        assert.strictEqual(await remote_save(LAPTOP, v => v, port), null);
        assert.deepStrictEqual(file_read(), json);

        // A new title on each: the title, and nothing else in the file
        for (const entry of [WHOAMI, FULL, PROG, FAR]) {
            assert.strictEqual((await service_save(entry, v => Object.assign(v, {title: `${entry.name} renamed`}), undefined, port)).note, '', entry.name);
        }
        assert.strictEqual(await remote_save(DESKTOP, v => Object.assign(v, {title: 'Desktop'}), port), null);
        assert.deepStrictEqual(file_read(), Object.assign({}, json, {
            remotes: [LAPTOP, Object.assign({}, DESKTOP, {title: 'Desktop'})],
            services: [WHOAMI, FULL, PROG, FAR].map(v => Object.assign({}, v, {title: `${v.name} renamed`})),
        }));
        // And serviceman runs what the file says
        assert.deepStrictEqual(app.service_by_name.whoami.run_args, ['--memory', '256m']);
        assert.deepStrictEqual(app.service_by_name.prog.argv, ['node', 'src/http.js', '--quiet']);
        assert.deepStrictEqual(app.config.remotes[1].log_dirs, [{path: '/var/log/nginx/*.log', service: 'nginx'}]);

        // The door itself still writes what it is given: a caller that PUTs a whole service
        // without `run_args` means none, and gets none back
        const bare = entry_omit(WHOAMI, 'run_args', 'args');
        const put = await fetch_host({port, host: '127.0.0.1', path: '/api/v1/services/whoami', method: 'PUT', body: JSON.stringify({service: bare})});
        assert.strictEqual(put.status, 200, put.body);
        assert.deepStrictEqual(file_read().services[0], bare);
    }
    finally {
        servers.control.close();
        servers.server.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// A component of the page without a browser: the code of its file as it is, given those of the
// modules it imports that are named in `kept`, and none of the others
async function component_of(file, kept)
{
    const text = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    const names = [];
    const values = [];
    for (const [, name, from] of text.matchAll(/^import (\w+) from '([^']+)';$/gm)) {
        names.push(name);
        values.push(kept.includes(from) ? (await import(path.join(PUBLIC, from))).default : undefined);
    }
    const body = text.replace(/^import .*$/gm, '').replace(/^export default (\w+);$/m, 'return $1;');
    return new Function(...names, `'use strict';\n${body}`)(...values);
}

// What `run` asks of serviceman, as the page asks it, each request noted in `sent`: answered
// here with a bare yes, or by the control door on `port` when one is given
async function fetch_swap(sent, port, run)
{
    const before = global.fetch;
    global.fetch = async function (url, options) {
        sent.push(JSON.parse(options.body));
        if (port === undefined) {
            return {ok: true, json: () => Promise.resolve({})};
        }
        const answer = await fetch_host({port, host: '127.0.0.1', path: url, method: options.method, body: options.body});
        return {ok: answer.status < 400, json: () => Promise.resolve(JSON.parse(answer.body))};
    };
    try {
        await run();
    }
    finally {
        global.fetch = before;
    }
}

// A card's Save of a service, by the page's own code: `change` is what was done to the fields.
// Answers what was sent, what the page shows it will write, and what Save said: '' for saved.
// `source` is the service a new one is a clone of.
async function service_save(original, change, source, port)
{
    const form = await component_of('service_form.js', ['./service_from_form.js', './secret_name_said.js', './secret_rows_write.js']);
    const props = {original: entry_freeze(original), source: (source === undefined) ? source : entry_freeze(source), names: []};
    // The fields as they stand, as on a service's own page: a new one's short form fills none in
    const self = Object.assign({}, form.methods, form.data.call(props), props, {model_now: () => self.model});
    change(self.model);
    const sent = [];
    const name = (original === null) ? '' : original.name;
    await fetch_swap(sent, port, () => self.write((original === null) ? 'POST' : 'PUT', `/api/v1/services/${name}`, self.model));
    return {sent: sent[0].service, shown: JSON.parse(form.computed.config_text.call(self)), note: self.note};
}

// A Save of a machine's Settings, by the page's own code: what was sent, or with a door what
// Save said, null for saved
async function remote_save(original, change, port)
{
    const form = await component_of('remote_form.js', ['./entry_from_form.js']);
    const props = {original: entry_freeze(original)};
    const self = Object.assign({}, form.methods, form.data.call(props), props, {$emit: function () {}});
    // Vue runs the hook before the first click
    if (form.created !== undefined) {
        form.created.call(self);
    }
    change(self.model);
    const sent = [];
    await fetch_swap(sent, port, () => self.save());
    if (port === undefined) {
        return sent[0].remote;
    }
    return self.bad ? self.note : null;
}

// A copy of an entry without some of its keys
function entry_omit(entry, ...keys)
{
    const out = Object.assign({}, entry);
    for (const key of keys) {
        delete out[key];
    }
    return out;
}

// An entry nothing may change: a write into it, or into anything in it, throws
function entry_freeze(value)
{
    if ((value === null) || (typeof value !== 'object')) {
        return value;
    }
    for (const key of Object.keys(value)) {
        entry_freeze(value[key]);
    }
    return Object.freeze(value);
}
