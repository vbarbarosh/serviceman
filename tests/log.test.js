const assert = require('assert');
const link_send_message = require('../src/helpers/link_send_message');
const log_event = require('../src/main/src/helpers/log_event');
const log_group = require('../src/main/src/helpers/log_group');
const log_group_from = require('../src/main/src/helpers/log_group_from');
const log_group_root = require('../src/main/src/helpers/log_group_root');
const log_trim = require('../src/main/src/helpers/log_trim');
const log_trunk = require('../src/main/src/helpers/log_trunk');
const log_words = require('../src/helpers/log_words');
const net = require('net');
const remote_attach = require('../src/main/src/helpers/remote_attach');
const remote_state = require('../src/main/src/helpers/remote_state');
const test = require('node:test');
const timers = require('timers/promises');
const url_logged = require('../src/main/src/helpers/url_logged');

const RE_LINE = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]\[(c[a-zA-Z0-9]+)\]\[([a-z_]+)\](.*)$/;

test('every line is time, group, sender and details, and each is a field of its own', function () {
    const app = app_new();
    log_group_root(app, function () {
        log_event(app, 'request_begin', {client: '127.0.0.1', host: 'site.test', method: 'GET', path: '/'});
    });
    const found = RE_LINE.exec(app.log_lines[1]);
    assert.notStrictEqual(found, null, app.log_lines[1]);
    assert.strictEqual(found[1], new Date(found[1]).toISOString(), 'utc, to the millisecond');
    assert.match(found[2], /^c[a-zA-Z0-9]+$/, 'a c, then letters and digits, and nothing else');
    assert.strictEqual(/[-_]/.test(found[2]), false, 'a dash or an underscore would break a double click');
    assert.strictEqual(found[3], 'request_begin');
    assert.strictEqual(found[4], ' client=127.0.0.1 host=site.test method=GET path=/');
});

test('stdout can go without the time, for a runtime that stamps every line itself', function () {
    const app = app_new();
    app.log_stdout_time = false;
    const said = [];
    const wrote = console.log;
    console.log = function (text) {
        said.push(text);
    };
    try {
        log_group_root(app, function () {
            log_event(app, 'request_begin', {host: 'site.test', path: '/'});
        });
    }
    finally {
        console.log = wrote;
    }
    assert.deepStrictEqual(said.map(v => v.slice(0, 1)), ['[', '['], 'the line starts at the group, not at a time');
    assert.match(said[1], /^\[c[a-zA-Z0-9]+\]\[request_begin\] host=site.test path=\/$/);
    assert.match(app.log_lines[1], /^\[\d{4}-\d{2}-\d{2}T/, 'the file and the page keep the time');
});

test('work inside work gets a uid of its own and says whose child it is', function () {
    const app = app_new();
    let inner = null;
    const outer = log_group_root(app, function (group) {
        inner = log_group(v => v);
        log_event(app, 'service_start_begin', {service: 'whoami', instance: 1});
        return group;
    });
    assert.notStrictEqual(inner.uid, outer.uid);
    assert.strictEqual(app.log_lines.length, 2, 'the inner group said nothing, so nothing was written for it');
    assert.match(app.log_lines[1], new RegExp(`\\[${outer.uid}\\]\\[service_start_begin\\]`));
});

test('a group is written the moment it speaks, with the groups above it before it', function () {
    const app = app_new();
    let deep = null;
    const trunk = log_trunk(app, function (group) {
        log_event(app, 'serviceman_begin', {config: '/srv/serviceman.json'});
        log_group_root(app, function (connection) {
            log_event(app, 'connection_begin', {client: '127.0.0.1:40172'});
            log_group(function (request) {
                deep = {connection, request};
                log_event(app, 'request_begin', {host: 'site.test', path: '/'});
            });
        });
        return group;
    });
    assert.deepStrictEqual(app.log_lines.map(v => v.slice(26)), [
        `[${trunk.uid}][group_spawn]`,
        `[${trunk.uid}][serviceman_begin] config=/srv/serviceman.json`,
        `[${deep.connection.uid}][group_spawn] parent=${trunk.uid}`,
        `[${deep.connection.uid}][connection_begin] client=127.0.0.1:40172`,
        `[${deep.request.uid}][group_spawn] parent=${deep.connection.uid}`,
        `[${deep.request.uid}][request_begin] host=site.test path=/`,
    ]);
});

test('every uid in the log begins with group_spawn, and only the process names no parent', function () {
    const app = app_new();
    const trunk = log_trunk(app, function (group) {
        log_event(app, 'serviceman_begin', {config: '/srv/serviceman.json'});
        // A group that says nothing, with a talking one under it: the silent one is still
        // explained, or its uid would appear from nowhere
        log_group_root(app, function () {
            log_group(function () {
                log_event(app, 'request_begin', {host: 'site.test', path: '/'});
            });
        });
        return group;
    });
    const spawned = [];
    const said = [];
    for (const line of app.log_lines) {
        const found = /\[(c[a-zA-Z0-9]+)\]\[([a-z_]+)\](.*)$/.exec(line);
        said.push(found[1]);
        if (found[2] !== 'group_spawn') {
            continue;
        }
        spawned.push(found[1]);
        if (found[1] === trunk.uid) {
            assert.strictEqual(found[3], '', 'the process itself came from nothing');
            continue;
        }
        assert.match(found[3], / parent=c[a-zA-Z0-9]+$/);
    }
    for (const uid of said) {
        assert.strictEqual(spawned.includes(uid), true, `${uid} appears with no line that says where it came from`);
    }
});

test('a group nobody spawned still says it began, and names no parent', function () {
    const app = app_new();
    log_group_root(app, function () {
        log_event(app, 'serviceman_begin', {config: '/srv/serviceman.json'});
    });
    assert.strictEqual(app.log_lines.length, 2);
    assert.match(app.log_lines[0], /\[group_spawn\]$/);
    assert.match(app.log_lines[1], /\[serviceman_begin\] config=\/srv\/serviceman\.json$/);
});

test('two groups never share a uid, however many there are', function () {
    const app = app_new();
    const seen = [];
    for (let i = 0; i < 200; i++) {
        log_group_root(app, function (group) {
            seen.push(group.uid);
            log_group(v => seen.push(v.uid));
        });
    }
    assert.strictEqual(new Set(seen).size, seen.length);
});

test('no line ever names itself as its own parent', function () {
    const app = app_new();
    // A start that restarts a program runs inside the start it retries; it is a child of it,
    // never a child of itself
    log_group_root(app, function () {
        log_group(function () {
            log_group(function () {
                log_event(app, 'service_start_begin', {service: 'faller', instance: 1});
            });
        });
    });
    for (const line of app.log_lines) {
        const found = /\[(c[a-zA-Z0-9]+)\]\[group_spawn\] parent=(\S+)/.exec(line);
        if (found !== null) {
            assert.notStrictEqual(found[1], found[2], line);
        }
    }
    assert.strictEqual(app.log_lines.filter(v => v.includes('[group_spawn]')).length, 3);
});

test('a value is bare when it is a plain word, and json when it is anything else', function () {
    assert.strictEqual(log_words({service: 'whoami', ms: 12}), 'service=whoami ms=12');
    assert.strictEqual(log_words({reason: 'idle for 4s'}), 'reason="idle for 4s"');
    assert.strictEqual(log_words({remote: null, service: 'a', instance: undefined}), 'service=a');
    assert.strictEqual(log_words(undefined), '');
    // Nothing in a value may break the shape of the line: no line break, no second word, and
    // never a square bracket that could read as a field of its own
    assert.strictEqual(log_words({said: 'he "shouted"'}), 'said="he \\"shouted\\""');
    assert.strictEqual(log_words({text: 'two\nlines'}), 'text="two\\nlines"');
    assert.strictEqual(log_words({tag: '[fake]'}), 'tag="[fake]"');
    assert.strictEqual(log_words({note: ''}), 'note=""');
    assert.strictEqual(log_words({of: ['vps1', 'vps2'], none: [], ok: true}), 'of=["vps1","vps2"] none=[] ok=true');
});

test('a line that would run long is cut on a character, and says how much was left out', function () {
    assert.strictEqual(log_trim('short', 100), 'short');
    assert.strictEqual(log_trim('abcdef', 3), 'abc...+3');
    // Three bytes each: the cut never lands inside one
    assert.strictEqual(log_trim('日本語', 4), '日...+6');
    // No room at all is no room: nothing is kept, and the count is of what was left out
    assert.strictEqual(log_trim('abcdef', 0), '...+6');
    assert.strictEqual(log_trim('abcdef', -3), '...+6');
    const app = app_new();
    log_group_root(app, function () {
        log_event(app, 'upstream_error', {reason: 'x'.repeat(4000)});
    });
    assert.strictEqual(Buffer.byteLength(app.log_lines[1], 'utf8') < 2000, true, app.log_lines[1].length);
    assert.match(app.log_lines[1], /\.\.\.\+\d+$/);
});

test('a query keeps its shape in the log and loses its values', function () {
    assert.strictEqual(url_logged('/report'), '/report');
    assert.strictEqual(url_logged('/report?token=hunter2&user=user'), '/report?token=***&user=***');
    assert.strictEqual(url_logged('/report?raw'), '/report?raw');
});

// What an agent says is written here as it said it, and it is that machine's word and no more.
// A machine that holds a token and is not the agent sent lines in another machine's name, a
// whole line of serviceman's own from a key with a line break in it, and a line of 100 kB.
test('a machine\'s line says the remote its link belongs to, whatever the line says of itself', async function (t) {
    const link = await machine_link(t, 'laptop');
    // What an agent sends, and what was always written for it
    assert.deepStrictEqual(await link.said([
        {type: 'log', group: 'caaaaaaaaaa1', sender: 'group_spawn', words: {parent: 'cbbbbbbbbbbb'}},
        {type: 'log', group: 'caaaaaaaaaa1', sender: 'agent_call_begin', words: {method: 'docker', argv: 'pull demo/whoami'}},
        {type: 'log', group: 'caaaaaaaaaa1', sender: 'agent_call_stdout', words: 'Status: remote=vps1 [is] up to date', service: 'whoami'},
        {type: 'log', group: 'caaaaaaaaaa1', sender: 'agent_call_end_ok', words: '0.160s'},
        {type: 'log', group: 'caaaaaaaaaa1', sender: 'program_killed', words: '5.071s service=whoami pid=42 note="it was asked to stop and did not"'},
        {type: 'log', group: 'caaaaaaaaaa1', sender: 'agent_connect_end_ok', words: {remote: 'laptop'}},
        {type: 'log', group: 'caaaaaaaaaa1', sender: 'agent_uptime_ok', words: {}},
    ]), [
        `[caaaaaaaaaa1][group_spawn] parent=${link.knock.uid}`,
        '[caaaaaaaaaa1][agent_call_begin] remote=laptop method=docker argv="pull demo/whoami"',
        '[caaaaaaaaaa1][agent_call_stdout] Status: remote=vps1 [is] up to date',
        '[caaaaaaaaaa1][agent_call_end_ok] 0.160s',
        '[caaaaaaaaaa1][program_killed] 5.071s service=whoami pid=42 note="it was asked to stop and did not"',
        '[caaaaaaaaaa1][agent_connect_end_ok] remote=laptop',
        '[caaaaaaaaaa1][agent_uptime_ok] remote=laptop',
    ]);
    // A line with no remote in it, then two in another machine's name, the key first and
    // last: it is laptop's link, and that is said once
    assert.deepStrictEqual(await link.said([
        {type: 'log', group: 'caaaaaaaaaa1', sender: 'agent_call_ok', words: {remote: null, method: 'docker'}},
        {type: 'log', group: 'caaaaaaaaaa1', sender: 'agent_call_ok', words: {remote: 'vps1', method: 'docker', argv: 'ps'}},
        {type: 'log', group: 'caaaaaaaaaa1', sender: 'agent_call_ok', words: {method: 'docker', remote: ['vps1']}},
    ]), [
        '[caaaaaaaaaa1][agent_call_ok] remote=laptop method=docker',
        `[${link.knock.uid}][remote_link_error] remote=laptop reason=log_line_remote sender=agent_call_ok claimed=vps1 then="written as its own, and said once for this link"`,
        '[caaaaaaaaaa1][agent_call_ok] remote=laptop method=docker argv=ps',
        '[caaaaaaaaaa1][agent_call_ok] remote=laptop method=docker',
    ]);
});

test('a key of a machine\'s line that is not a word is left out, and starts no line of its own', async function (t) {
    const since = Date.now();
    const link = await machine_link(t, 'laptop');
    const forged = `a=1\n[2026-11-09T03:00:00.000Z][${link.trunk.uid}][serviceman_end_ok] signal`;
    assert.deepStrictEqual(await link.said([
        {type: 'log', group: 'caaaaaaaaaa2', sender: 'agent_call_ok', time: '2026-11-09T03:00:00.000Z', words: {[forged]: 'SIGTERM', containers: 'left running'}},
        {type: 'log', group: 'caaaaaaaaaa2', sender: 'agent_call_ok', words: {'two words': 1, 'Upper': 2, '9first': 3, 'da-sh': 4, '': 5, 'a]b': 6, 'ok_1': 7, ['__proto__']: 8}},
        {type: 'log', group: 'caaaaaaaaaa2', sender: 'agent_call_ok', words: ['a', 'list']},
        {type: 'log', group: 'caaaaaaaaaa2', sender: 'agent_call_ok', words: 7},
    ]), [
        `[caaaaaaaaaa2][group_spawn] parent=${link.knock.uid}`,
        `[${link.knock.uid}][remote_link_error] remote=laptop reason=log_line_key sender=agent_call_ok key=${JSON.stringify(forged.slice(0, 40))} then="written without it, and said once for this link"`,
        '[caaaaaaaaaa2][agent_call_ok] remote=laptop containers="left running"',
        '[caaaaaaaaaa2][agent_call_ok] remote=laptop ok_1=7 __proto__=8',
        '[caaaaaaaaaa2][agent_call_ok] remote=laptop',
        '[caaaaaaaaaa2][agent_call_ok] remote=laptop',
    ]);
    // Fifty more of them are fifty lines without the key, and not one line more about it
    const flood = await link.said(Array.from({length: 50}, (v, i) => ({type: 'log', group: 'caaaaaaaaaa2', sender: 'agent_call_ok', words: {[`${forged}${i}`]: 'SIGTERM'}})));
    assert.deepStrictEqual(flood, Array.from({length: 50}, () => '[caaaaaaaaaa2][agent_call_ok] remote=laptop'));
    for (const line of link.app.log_lines) {
        const found = RE_LINE.exec(line);
        assert.notStrictEqual(found, null, line);
        assert.strictEqual(Date.parse(found[1]) >= since, true, `the time of a line is this end's: ${line}`);
    }
    assert.deepStrictEqual(link.app.log_lines.filter(v => v.includes(`[${link.trunk.uid}]`)).map(v => v.slice(26)), [`[${link.trunk.uid}][group_spawn]`, `[${link.trunk.uid}][serviceman_begin]`], 'under the process\'s group stands what the process said, and nothing else');
});

test('a machine\'s line stays under 2k bytes and on one line, whatever its sender, its keys and its values hold', async function (t) {
    const link = await machine_link(t, 'laptop');
    const lines = await link.said([
        {type: 'log', group: 'caaaaaaaaaa3', sender: 'a'.repeat(100000), words: {}},
        {type: 'log', group: 'caaaaaaaaaa3', sender: 'a'.repeat(65), words: {}},
        {type: 'log', group: 'caaaaaaaaaa3', sender: ['group_spawn'], words: {parent: link.trunk.uid}},
        {type: 'log', group: 'caaaaaaaaaa3][forged', sender: 'agent_call_ok', words: {}},
        {type: 'log', group: 'caaaaaaaaaa3', sender: 'a'.repeat(64), words: {}},
        {type: 'log', group: 'caaaaaaaaaa3', sender: 'long_value', words: {reason: 'x'.repeat(100000)}},
        {type: 'log', group: 'caaaaaaaaaa3', sender: 'long_key', words: {['k'.repeat(100000)]: 1}},
        {type: 'log', group: 'caaaaaaaaaa3', sender: 'long_text', words: '日'.repeat(100000)},
        {type: 'log', group: 'caaaaaaaaaa3', sender: 'odd_values', words: {deep: {list: [1, 'two\nlines']}, tag: '][cbbbbbbbbbbb][forged]', color: '\x1b[31mred', cr: 'a\rb', none: null}},
        {type: 'log', group: 'caaaaaaaaaa3', sender: 'odd_text', words: `done\n[2026-11-09T03:00:00.000Z][${link.trunk.uid}][serviceman_end_ok] signal=SIGTERM`},
    ]);
    assert.deepStrictEqual(lines.slice(0, 3), [
        `[${link.knock.uid}][remote_link_error] remote=laptop reason=log_line_shape group=caaaaaaaaaa3 sender=${'a'.repeat(40)} then="not written, and said once for this link"`,
        `[caaaaaaaaaa3][group_spawn] parent=${link.knock.uid}`,
        `[caaaaaaaaaa3][${'a'.repeat(64)}] remote=laptop`,
    ]);
    assert.match(lines[3], /^\[caaaaaaaaaa3\]\[long_value\] remote=laptop reason=x+\.\.\.\+\d+$/);
    assert.match(lines[4], /^\[caaaaaaaaaa3\]\[long_key\] remote=laptop k+\.\.\.\+\d+$/);
    assert.match(lines[5], /^\[caaaaaaaaaa3\]\[long_text\] 日+\.\.\.\+\d+$/);
    assert.deepStrictEqual(lines.slice(6), [
        '[caaaaaaaaaa3][odd_values] remote=laptop deep={"list":[1,"two\\nlines"]} tag="][cbbbbbbbbbbb][forged]" color="\\u001b[31mred" cr="a\\rb"',
        `[caaaaaaaaaa3][odd_text] "done\\n[2026-11-09T03:00:00.000Z][${link.trunk.uid}][serviceman_end_ok] signal=SIGTERM"`,
    ]);
    for (const line of link.app.log_lines) {
        assert.strictEqual(Buffer.byteLength(line, 'utf8') < 2000, true, `${Buffer.byteLength(line, 'utf8')} bytes: ${line.slice(0, 100)}`);
        assert.notStrictEqual(RE_LINE.exec(line), null, line.slice(0, 200));
        assert.strictEqual(/[\x00-\x08\x0a-\x1f]/.test(line), false, JSON.stringify(line.slice(0, 200)));
    }
});

test('a machine writes under no group this end made: not its link\'s, nor the connection\'s, nor the process\'s', async function (t) {
    const link = await machine_link(t, 'laptop');
    const before = link.app.log_lines.length;
    const lines = [];
    for (const group of [link.trunk, link.connection, link.knock]) {
        lines.push(...await link.said([
            {type: 'log', group: group.uid, sender: 'serviceman_end_ok', words: 'signal=SIGTERM containers="left running"'},
            {type: 'log', group: group.uid, sender: 'serviceman_end_ok', words: {signal: 'SIGTERM'}},
            {type: 'log', group: group.uid, sender: 'group_spawn', words: {}},
        ]));
    }
    assert.deepStrictEqual(lines, [
        `[${link.knock.uid}][remote_link_error] remote=laptop reason=log_line_group group=${link.trunk.uid} sender=serviceman_end_ok then="not written, and said once for this link"`,
    ]);
    assert.strictEqual(link.app.log_lines.slice(before).some(v => v.includes('[group_spawn]') && (v.includes('cendendenden') === false)), false, 'no group this end made was given a parent by a machine');
    // A new link is a new story: what could not be kept on it is said again, once
    const again = await machine_link(t, 'laptop', link.remote);
    const line = {type: 'log', group: again.knock.uid, sender: 'serviceman_end_ok', words: 'signal=SIGTERM'};
    assert.deepStrictEqual(await again.said([line, line]), [
        `[${again.knock.uid}][remote_link_error] remote=laptop reason=log_line_group group=${again.knock.uid} sender=serviceman_end_ok then="not written, and said once for this link"`,
    ]);
});

function app_new()
{
    return {log_lines: [], file_log: null, log_group: null, log_stdout_time: true};
}

// A machine's link, joined the way the server joins one: in the group of the knock, under its
// connection, under the process. {app, remote, trunk, connection, knock, said}, where
// `said(messages)` sends them as that machine would and answers what serviceman wrote for
// them, each line without its time. One honest line goes after them: when it is written, the
// ones before it were read, and the link still takes lines. `before` is the remote of a link
// made earlier, for the same machine dialling in again.
async function machine_link(t, name, before)
{
    const app = Object.assign(app_new(), {config: {join: null}, service_by_name: {}});
    const remote = (before === undefined) ? {name, title: null, tags: [], machine: null, state: remote_state()} : before;
    const server = net.createServer();
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    const accepted = new Promise(v => server.once('connection', v));
    const agent = net.connect(server.address().port, '127.0.0.1');
    const host = await accepted;
    const log = console.log;
    console.log = function () {};
    t.after(function () {
        console.log = log;
        host.removeAllListeners('close');
        host.destroy();
        agent.destroy();
        server.close();
    });
    const out = {app, remote, trunk: null, connection: null, knock: null, said};
    log_trunk(app, function (trunk) {
        out.trunk = trunk;
        log_event(app, 'serviceman_begin', undefined);
        log_group_root(app, function (connection) {
            out.connection = connection;
            log_group_from(connection, function (knock) {
                out.knock = knock;
                log_event(app, 'remote_online', {remote: name});
                remote_attach(app, remote, host);
                remote.state.phase = 'online';
            });
        });
    });
    let batches = 0;
    async function said(messages) {
        const from = app.log_lines.length;
        for (const message of messages) {
            link_send_message(agent, message);
        }
        batches++;
        const done = `[cendendenden][machine_done] remote=${name} batch=${batches}`;
        link_send_message(agent, {type: 'log', group: 'cendendenden', sender: 'machine_done', words: {batch: batches}});
        await until(() => app.log_lines.some(v => v.endsWith(done)));
        assert.strictEqual(remote.state.socket, host, 'the link is the one it was');
        assert.strictEqual(host.destroyed, false, 'and it is up');
        return app.log_lines.slice(from).map(v => v.slice(26)).filter(v => v.includes('[cendendenden]') === false);
    }
    return out;
}

async function until(ok)
{
    const deadline = Date.now() + 3000;
    while (ok() === false) {
        if (Date.now() > deadline) {
            throw new Error('waited too long');
        }
        await timers.setTimeout(10);
    }
}

function stamped(app, at, tail)
{
    return `${app.log_lines[at].slice(0, 19)} ${tail}`;
}
