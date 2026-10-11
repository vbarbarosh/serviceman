const assert = require('assert');
const log_event = require('../src/main/src/helpers/log_event');
const log_group = require('../src/main/src/helpers/log_group');
const log_group_root = require('../src/main/src/helpers/log_group_root');
const log_trim = require('../src/main/src/helpers/log_trim');
const log_trunk = require('../src/main/src/helpers/log_trunk');
const log_words = require('../src/helpers/log_words');
const test = require('node:test');
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

function app_new()
{
    return {log_lines: [], file_log: null, log_group: null, log_stdout_time: true};
}

function stamped(app, at, tail)
{
    return `${app.log_lines[at].slice(0, 19)} ${tail}`;
}
