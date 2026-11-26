const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const page_fetch_begin = require('./page_fetch_begin');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const service_rename_ties = require('../src/main/src/helpers/service_rename_ties');
const test = require('node:test');

const REMOTES = [
    {name: 'server', token: 'a'.repeat(32)},
    {name: 'laptop', token: 'b'.repeat(32)},
    {name: 'vps1', token: 'c'.repeat(32)},
];

// The author's program: kept running on the server, its port brought to the laptop
const LLM = {name: 'llm', type: 'shell', remote: 'server', cwd: '/home/user/llm', command: 'sg render -c \'./llama-server --host 127.0.0.1 --port 8080\'', policy: {start: 'always', restart: 'always'}};
const TO_LAPTOP = {label: 'llm → laptop', from: {remote: 'server', port: 8080}, to: {remote: 'laptop', socket: '~/.sockets/llm.sock'}};
const TO_SERVER = {label: 'llm → server', from: {remote: 'server', port: 8080}, to: {remote: 'server', port: 8081}};

// A forward of its own, written by hand, with what no form writes: it never moves or changes
const LOKI = {label: 'Loki on vps1', from: {remote: 'vps1', port: 3100}, to: {remote: 'laptop', socket: '~/repos/loki.sock'}, off: true};

test('a forward that is part of a service reads with it, and one part of nobody is refused', function () {
    const config = config_of([LLM], [LOKI, Object.assign({service: 'llm'}, TO_LAPTOP)]);
    assert.deepStrictEqual(config.forwards.map(v => [v.label, v.service]), [['Loki on vps1', null], ['llm → laptop', 'llm']]);
    assert.throws(() => config_of([LLM], [Object.assign({service: 'nobody'}, TO_LAPTOP)]), {message: 'forwards[0].service: no service named "nobody" is in the config'});
    for (const wrong of [null, '', 'Two Words', 7, {name: 'llm'}]) {
        assert.throws(() => config_of([LLM], [Object.assign({}, TO_LAPTOP, {service: wrong})]), {message: `forwards[0].service: the name of the service it is part of, or left out (got ${JSON.stringify(wrong)})`});
    }
});

test('a renamed service carries the forwards that are part of it, and leaves the others', function () {
    const json = {forwards: [Object.assign({}, LOKI), Object.assign({service: 'llm'}, TO_LAPTOP), Object.assign({service: 'other'}, TO_SERVER)]};
    service_rename_ties({}, json, 'llm', 'qwen');
    assert.deepStrictEqual(json.forwards.map(v => v.service), [undefined, 'qwen', 'other']);
    assert.deepStrictEqual(json.forwards[0], LOKI);
});

// One Save writes the program and its forwards; a rename carries them, a move to another
// machine brings them from there, a new list takes their place alone, and a removal takes them.
// The forward of its own stays exactly as written, where it was, through all of it.
test('a program and its forwards are one save, and stay together until it is removed', async function () {
    const running = await control_start([], [LOKI]);
    try {
        const made = await running.call('POST', '/api/v1/services', {service: LLM, forwards: [TO_LAPTOP, TO_SERVER]});
        assert.strictEqual(made.status, 200, made.body);
        assert.deepStrictEqual(running.file().forwards, [LOKI, Object.assign({}, TO_LAPTOP, {service: 'llm'}), Object.assign({}, TO_SERVER, {service: 'llm'})]);
        assert.deepStrictEqual(running.app.config.forwards.map(v => v.service), [null, 'llm', 'llm']);
        const view = JSON.parse((await running.call('GET', '/api/v1/status')).body).forwards.find(v => v.label === 'llm → laptop');
        assert.strictEqual(view.service, 'llm', 'the page finds them by the service');

        // Renamed: its forwards say so, their labels as they were
        const renamed = await running.call('PUT', '/api/v1/services/llm', {service: Object.assign({}, LLM, {name: 'qwen'})});
        assert.strictEqual(renamed.status, 200, renamed.body);
        assert.deepStrictEqual(running.file().forwards.map(v => [v.label, v.service]), [['Loki on vps1', undefined], ['llm → laptop', 'qwen'], ['llm → server', 'qwen']]);

        // Moved to vps1: its port comes from there now; where it shows up stays as it was
        const moved = await running.call('PUT', '/api/v1/services/qwen', {service: Object.assign({}, LLM, {name: 'qwen', remote: 'vps1'})});
        assert.strictEqual(moved.status, 200, moved.body);
        assert.deepStrictEqual(running.file().forwards.map(v => [v.from.remote, v.to.remote]), [['vps1', 'laptop'], ['vps1', 'laptop'], ['vps1', 'server']]);
        assert.deepStrictEqual(running.file().forwards[0], LOKI);

        // A list of machines is no one machine: nothing moves
        const listed = await running.call('PUT', '/api/v1/services/qwen', {service: Object.assign({}, LLM, {name: 'qwen', remote: undefined, remotes: ['server', 'vps1']})});
        assert.strictEqual(listed.status, 200, listed.body);
        assert.deepStrictEqual(running.file().forwards.map(v => v.from.remote), ['vps1', 'vps1', 'vps1']);

        // Its card saved: the list given takes the place of its own, where the first of them was
        const one = {label: 'qwen → laptop', from: {remote: 'vps1', port: 8080}, to: {remote: 'laptop', port: 18080}};
        const saved = await running.call('PUT', '/api/v1/services/qwen', {service: Object.assign({}, LLM, {name: 'qwen', remote: 'vps1'}), forwards: [one]});
        assert.strictEqual(saved.status, 200, saved.body);
        assert.deepStrictEqual(running.file().forwards, [LOKI, Object.assign({}, one, {service: 'qwen'})]);

        // One the config refuses refuses the whole save: the service stays as it was too
        const loops = {label: 'loops', from: {remote: 'vps1', port: 8080}, to: {remote: 'vps1', port: 8080}};
        const refused = await running.call('PUT', '/api/v1/services/qwen', {service: Object.assign({}, LLM, {name: 'qwen', remote: 'vps1', command: 'changed'}), forwards: [loops]});
        assert.strictEqual(refused.status, 400);
        assert.strictEqual(JSON.parse(refused.body).error, 'forwards[1].from: where the forward listens itself, on vps1; each connection would reach itself');
        assert.strictEqual(running.file().services[0].command, LLM.command);
        const bad_list = await running.call('PUT', '/api/v1/services/qwen', {service: LLM, forwards: 'all of them'});
        assert.deepStrictEqual([bad_list.status, JSON.parse(bad_list.body).error], [400, 'forwards: the forwards that are part of it, a list']);

        // Removed: its forwards go with it, and the answer names them
        const removed = await running.call('DELETE', '/api/v1/services/qwen');
        assert.strictEqual(removed.status, 200, removed.body);
        assert.deepStrictEqual(JSON.parse(removed.body).forwards_removed, ['qwen → laptop']);
        assert.deepStrictEqual(running.file().forwards, [LOKI]);
        assert.deepStrictEqual(running.app.config.forwards.map(v => v.label), ['Loki on vps1']);
    }
    finally {
        running.close();
    }
});

test('a service with no forward of its own is removed as before, every other forward as written', async function () {
    const running = await control_start([LLM], [LOKI]);
    const text = JSON.stringify(running.file().forwards);
    try {
        const removed = await running.call('DELETE', '/api/v1/services/llm');
        assert.strictEqual(removed.status, 200, removed.body);
        assert.deepStrictEqual(JSON.parse(removed.body).forwards_removed, []);
        assert.strictEqual(JSON.stringify(running.file().forwards), text);
    }
    finally {
        running.close();
    }
});

// A forward that is part of a service goes with the service, which is the owner's: a token with
// the forwards right neither sees it nor takes it away, nor ties one of its own to a service
test('a token neither reads nor writes a forward that is part of a service', async function () {
    const tied = Object.assign({}, TO_LAPTOP, {service: 'llm'});
    const running = await control_start([LLM], [LOKI, tied]);
    try {
        const made = await running.call('POST', '/api/v1/tokens', {label: 'visual-agency', remotes: ['server', 'laptop', 'vps1'], rights: ['forwards']});
        assert.strictEqual(made.status, 200, made.body);
        const token = JSON.parse(made.body).token;
        const listed = await running.call('GET', '/api/v1/forwards', undefined, token);
        assert.deepStrictEqual(JSON.parse(listed.body).forwards, [LOKI]);

        const own = {label: 'mine', from: {remote: 'vps1', port: 3000}, to: {remote: 'laptop', port: 3000}};
        const tying = await running.call('PUT', '/api/v1/forwards', {forwards: [Object.assign({service: 'llm'}, own)]}, token);
        assert.strictEqual(tying.status, 403);
        assert.strictEqual(JSON.parse(tying.body).error, 'forwards[0]: the token "visual-agency" may not hold a forward that is part of a service: it goes with the service, and is the owner\'s');

        // Its list takes the place of the forwards it sees; the program's stays, where it was
        const written = await running.call('PUT', '/api/v1/forwards', {forwards: [own]}, token);
        assert.strictEqual(written.status, 200, written.body);
        assert.deepStrictEqual(running.file().forwards.map(v => v.label), ['mine', 'llm → laptop']);
        assert.deepStrictEqual(running.file().forwards[1], tied);
    }
    finally {
        running.close();
    }
});

// Changed on Forwards, a forward that is part of a program stays its part: the section keeps
// the tie it does not show in its form. The section is driven as vue drives it, its data and its
// methods on one object.
test('a forward changed on Forwards stays part of its program', async function () {
    const forwards_section = (await import('../src/main/public/forwards_section.js')).default;
    const tied = Object.assign({}, TO_LAPTOP, {service: 'llm'});
    const running = await control_start([LLM], [LOKI, tied]);
    const page_fetch_end = page_fetch_begin(running.port);
    try {
        const fresh = {label: 'llm → laptop', from_remote: 'server', from: '8080', to_remote: 'laptop', to: '~/.sockets/qwen.sock'};
        const form = Object.assign(forwards_section.data(), forwards_section.methods, {ready: true, making: true, editing: {label: 'llm → laptop'}, fresh});
        await form.write();
        assert.deepStrictEqual([form.note, form.making], ['', false]);
        assert.deepStrictEqual(running.file().forwards, [LOKI, {label: 'llm → laptop', service: 'llm', from: {remote: 'server', port: 8080}, to: {remote: 'laptop', socket: '~/.sockets/qwen.sock'}}]);
    }
    finally {
        page_fetch_end();
        running.close();
    }
});

// A database server's forward changed on Forwards stays part of the server, and says whose it is
test('a forward changed on Forwards stays part of its database server', async function () {
    const forwards_section = (await import('../src/main/public/forwards_section.js')).default;
    const tied = {label: 'mongodb-1 → laptop', database: 'mongodb-1', from: {remote: 'server', port: 41337}, to: {remote: 'laptop', port: 27017}};
    const running = await control_start([LLM], [LOKI, tied]);
    const page_fetch_end = page_fetch_begin(running.port);
    try {
        // Its line on Forwards, with nothing in its way
        const lines = Object.assign(forwards_section.data(), forwards_section.methods, {wrong_text: () => ''});
        assert.strictEqual(lines.line_of({by: null, service: null, database: 'mongodb-1'}), 'part of mongodb-1, on Databases');
        const fresh = {label: 'mongodb-1 → laptop', from_remote: 'server', from: '41337', to_remote: 'laptop', to: '27018'};
        const form = Object.assign(forwards_section.data(), forwards_section.methods, {ready: true, making: true, editing: {label: 'mongodb-1 → laptop'}, fresh});
        await form.write();
        assert.deepStrictEqual([form.note, form.making], ['', false]);
        assert.deepStrictEqual(running.file().forwards, [LOKI, {label: 'mongodb-1 → laptop', database: 'mongodb-1', from: {remote: 'server', port: 41337}, to: {remote: 'laptop', port: 27018}}]);
    }
    finally {
        page_fetch_end();
        running.close();
    }
});

// The card "Its port on another machine" holds the forwards that are part of a program as a port
// and the machines it is brought to; what it writes back is the config's shape, an empty box
// standing for what it says it does
test('the program\'s card reads its forwards, writes them back, and fills what was left empty', async function () {
    const brought_from_forwards = (await import('../src/main/public/brought_from_forwards.js')).default;
    const forwards_from_brought = (await import('../src/main/public/forwards_from_brought.js')).default;
    const machines = [{name: 'server', title: '', phase: 'online'}, {name: 'laptop', title: 'Laptop', phase: 'online'}, {name: 'vps1', title: '', phase: 'offline'}];
    const program = {name: 'llm', machine: 'server', port: '', remotes: machines, tried: true, labels: ['Loki on vps1']};

    // A new program: the port typed once, a socket of its name on the laptop, a port of its own
    // on its own machine
    const fresh = {port: '8080', targets: [target('laptop', 'socket', '', ''), target('server', 'port', '', '8081')], kept: []};
    assert.deepStrictEqual(forwards_from_brought(fresh, program), [
        {label: 'llm → laptop', service: 'llm', from: {remote: 'server', port: 8080}, to: {remote: 'laptop', socket: '~/.sockets/llm.sock'}},
        {label: 'llm → server', service: 'llm', from: {remote: 'server', port: 8080}, to: {remote: 'server', port: 8081}},
    ]);

    // Read back, it is the same card; unchanged, it writes the file's forwards as they were,
    // `off` and the order of their keys with them
    const file = [
        Object.assign({service: 'llm'}, TO_LAPTOP, {off: true}),
        Object.assign({}, TO_SERVER, {service: 'llm'}),
        {label: 'by hand', service: 'llm', from: {remote: 'server', socket: '/run/llm.sock'}, to: {remote: 'laptop', port: 9000}},
    ];
    const card = brought_from_forwards(file);
    assert.deepStrictEqual(card, {
        port: '8080',
        targets: [
            {key: 'llm → laptop', remote: 'laptop', kind: 'socket', socket: '~/.sockets/llm.sock', port: '', original: file[0]},
            {key: 'llm → server', remote: 'server', kind: 'port', socket: '', port: '8081', original: file[1]},
        ],
        kept: [file[2]],
    });
    assert.strictEqual(JSON.stringify(forwards_from_brought(card, program)), JSON.stringify(file));

    // A machine changed is a new label; one changed in place keeps its own, and its `off`
    card.targets[1].remote = 'vps1';
    card.targets[1].kind = 'socket';
    card.targets[1].socket = '';
    card.targets[0].socket = '/tmp/llm.sock';
    card.port = '9090';
    assert.deepStrictEqual(forwards_from_brought(card, Object.assign({}, program, {labels: ['llm → vps1']})), [
        {label: 'llm → laptop', service: 'llm', from: {remote: 'server', port: 9090}, to: {remote: 'laptop', socket: '/tmp/llm.sock'}, off: true},
        {label: 'llm → vps1 2', service: 'llm', from: {remote: 'server', port: 9090}, to: {remote: 'vps1', socket: '~/.sockets/llm.sock'}},
        file[2],
    ]);

    // Two sockets on one machine are two files; the port under What runs stands for an empty one
    const twice = {port: '', targets: [target('laptop', 'socket', '', ''), target('laptop', 'socket', '', '')], kept: []};
    assert.deepStrictEqual(forwards_from_brought(twice, Object.assign({}, program, {port: '8000'})).map(v => [v.label, v.from.port, v.to.socket]), [
        ['llm → laptop', 8000, '~/.sockets/llm.sock'],
        ['llm → laptop 2', 8000, '~/.sockets/llm-2.sock'],
    ]);
});

test('the program\'s card says what is wrong where it is wrong', async function () {
    const brought_said = (await import('../src/main/public/brought_said.js')).default;
    const machines = [{name: 'server', title: '', phase: 'online'}, {name: 'laptop', title: 'Laptop', phase: 'online'}, {name: 'vps1', title: '', phase: 'offline'}];
    const program = {name: 'llm', machine: 'server', port: '', remotes: machines, tried: false};
    function said(port, targets, given) {
        return brought_said({port, targets, kept: []}, Object.assign({}, program, given));
    }

    // Nothing to bring over, or all of it fine
    assert.strictEqual(said('', [], {}).problem, null);
    const fine = said('8080', [target('laptop', 'socket', '', ''), target('server', 'port', '', '8081'), target('vps1', 'socket', '', '')], {});
    assert.strictEqual(fine.problem, null);
    assert.deepStrictEqual(fine.targets.map(v => v.text), [
        '~/.sockets/llm.sock on Laptop: a socket file only its agent\'s user may open; ~ is that user\'s home.',
        'Port 8081 on the loopback of server, beside it: its agent joins the two itself.',
        '~/.sockets/llm.sock on vps1: a socket file only its agent\'s user may open; ~ is that user\'s home.',
    ]);
    assert.deepStrictEqual(fine.targets.map(v => v.away), ['', '', 'vps1\'s agent is not connected now: it listens once the agent dials in.']);

    // Typed wrong: said at once. Left empty: said once Save is pressed
    const cases = [
        [said('80x', [target('laptop', 'socket', '', '')], {}), 'A port is a whole number from 1 to 65535.'],
        [said('8080', [target('laptop', 'socket', 'llm.sock', '')], {}), 'A socket file from / or ~/, as ~/.sockets/llm.sock.'],
        [said('8080', [target('laptop', 'socket', `~/${'x'.repeat(99)}`, '')], {}), 'A socket file\'s path of at most 100 characters: this one has 101.'],
        [said('8080', [target('server', 'port', '', '8080')], {}), '8080 is where the program listens on server: another port, or a socket file.'],
        [said('8080', [target('laptop', 'port', '', '70000')], {}), 'A port is a whole number from 1 to 65535.'],
        [said('8080', [target('laptop', 'socket', '', ''), target('laptop', 'socket', '~/.sockets/llm.sock', '')], {}), 'a line above already brings it there: another socket file or port'],
        [said('8080', [target('laptop', 'socket', '', '')], {machine: null}), 'It is brought over from the one machine it runs on: name one under Where it runs, not a list or a tag.'],
        [said('', [target('laptop', 'socket', '', '')], {tried: true}), 'The port it listens on is needed, to be brought over.'],
        [said('8080', [target('server', 'port', '', '')], {tried: true}), 'On server itself, a port of its own: 8080 is the program\'s.'],
        [said('8080', [target('', 'socket', '', '')], {tried: true}), 'Pick the machine it is brought to.'],
    ];
    for (const [given, problem] of cases) {
        assert.strictEqual(given.problem, problem);
    }
    assert.strictEqual(said('', [target('laptop', 'socket', '', '')], {}).problem, null, 'empty waits for Save');
    assert.strictEqual(said('8080', [target('server', 'port', '', '')], {}).problem, null, 'empty waits for Save');
});

// serviceman runs on the laptop itself, and the program's port shows up beside it, a socket file
// in its state dir, with no agent on the laptop
test('the program\'s card brings its port to this host, where serviceman runs', async function () {
    const brought_from_forwards = (await import('../src/main/public/brought_from_forwards.js')).default;
    const brought_said = (await import('../src/main/public/brought_said.js')).default;
    const forwards_from_brought = (await import('../src/main/public/forwards_from_brought.js')).default;
    const machines = [{name: 'server', title: '', phase: 'online'}, {name: 'laptop', title: 'Laptop', phase: 'offline'}];
    const program = {name: 'llm', machine: 'server', port: '', remotes: machines, tried: true, labels: []};

    // Left empty, a socket file named after it in serviceman's sockets/, or its port
    const fresh = {port: '8080', targets: [target(null, 'socket', '', ''), target(null, 'port', '', '')], kept: []};
    const said = brought_said(fresh, program);
    assert.strictEqual(said.problem, null);
    assert.deepStrictEqual(said.targets.map(v => [v.text, v.away]), [
        ['sockets/llm.sock in serviceman\'s state dir, on this host: a socket file only serviceman\'s user may open.', ''],
        ['Port 8080 on the loopback of this host, where serviceman runs, 127.0.0.1 and nowhere else.', ''],
    ]);
    const written = forwards_from_brought(fresh, program);
    assert.deepStrictEqual(written, [
        {label: 'llm → this host', service: 'llm', from: {remote: 'server', port: 8080}, to: {here: true, socket: 'sockets/llm.sock'}},
        {label: 'llm → this host 2', service: 'llm', from: {remote: 'server', port: 8080}, to: {here: true, port: 8080}},
    ]);
    // What it writes, the config reads: serviceman listens for it itself
    const config = config_of([LLM], written);
    assert.deepStrictEqual(config.forwards.map(v => [v.service, v.to.here, v.to.socket, v.to.port]), [['llm', true, 'sockets/llm.sock', null], ['llm', true, null, 8080]]);

    // The author's forward as written by hand, part of the program now: the card reads it as
    // this host, and writes it back as it was
    const file = [{label: 'llm-8080', service: 'llm', from: {remote: 'server', port: 8080}, to: {here: true, socket: 'sockets/llm.sock'}}];
    const card = brought_from_forwards(file);
    assert.deepStrictEqual(card.targets.map(v => [v.remote, v.kind, v.socket]), [[null, 'socket', 'sockets/llm.sock']]);
    assert.deepStrictEqual(card.kept, []);
    assert.strictEqual(JSON.stringify(forwards_from_brought(card, program)), JSON.stringify(file));
    // Moved to the laptop, it is a forward of a new label; back here, the label it had
    card.targets[0].remote = 'laptop';
    card.targets[0].socket = '';
    assert.deepStrictEqual(forwards_from_brought(card, program)[0], {label: 'llm → laptop', service: 'llm', from: {remote: 'server', port: 8080}, to: {remote: 'laptop', socket: '~/.sockets/llm.sock'}});

    // A path of serviceman's own stays inside its state dir
    const wrong = [
        ['/run/llm.sock', 'A socket file inside serviceman\'s state dir, written from it: sockets/llm.sock.'],
        ['~/.sockets/llm.sock', 'A socket file inside serviceman\'s state dir, written from it: sockets/llm.sock.'],
        ['sockets/../../llm.sock', 'A path that stays inside serviceman\'s state dir, with no .. in it: sockets/llm.sock.'],
        [`sockets/${'x'.repeat(100)}`, 'A socket file\'s path of at most 100 characters: this one has 108.'],
    ];
    for (const [socket, problem] of wrong) {
        assert.strictEqual(brought_said({port: '8080', targets: [target(null, 'socket', socket, '')], kept: []}, program).problem, problem);
    }
});

function target(remote, kind, socket, port)
{
    return {key: Math.random(), remote, kind, socket, port, original: null};
}

function config_of(services, forwards)
{
    return config_from_json({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: REMOTES, services, forwards}, __dirname);
}

// serviceman on a config file of its own, its state beside it, with no machine dialled in
async function control_start(services, forwards)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-service-forwards-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: REMOTES, services, forwards}, null, 4));
    const config = config_from_json(JSON.parse(fs.readFileSync(config_path, 'utf8')), dir);
    config.path = config_path;
    const app = app_from_config(config);
    app.state_dir = dir;
    const servers = await server_start(app);
    const port = servers.control.address().port;
    return {
        app,
        port,
        call: function (method, url, body, token) {
            return fetch_host({port, host: '127.0.0.1', path: url, method, token, body: (body === undefined) ? undefined : JSON.stringify(body)});
        },
        file: function () {
            return JSON.parse(fs.readFileSync(config_path, 'utf8'));
        },
        close: function () {
            for (const door of [servers.server, servers.control]) {
                door.close();
                door.closeAllConnections();
            }
            fs.rmSync(dir, {recursive: true, force: true});
        },
    };
}
