const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

// The viewer's own page, app.js, run without a browser: every query it sends to ClickHouse waits
// here until the test answers it, or until the page lets go of it
const APP_JS = path.join(__dirname, '..', '..', 'log-ui', 'app.js');

// A search left on its way keeps its clock: each test's pages are let go after it
const pages = [];

test.afterEach(function () {
    for (const page of pages.splice(0)) {
        page.app.searchController?.abort();
        clearInterval(page.app.clockTimer);
    }
});

test('every query of a range reads only the days of that range', function () {
    const page = page_start();
    const {where, params} = page.app.buildWhere({from: '2026-11-01T10:00:00.000Z', to: '2026-11-01T11:00:00.000Z', terms: [], excludeTerms: [], labels: {}});
    // The table is split by day and kept in order by TimestampTime: a bound on Timestamp alone
    // reads every part of the table, whatever the range
    assert.match(where, /TimestampTime >= toDateTime\(parseDateTime64BestEffort\(\{range_from:String\}, 9, 'UTC'\)\)/);
    assert.match(where, /TimestampTime <= toDateTime\(parseDateTime64BestEffort\(\{range_to:String\}, 9, 'UTC'\)\)/);
    assert.match(where, /Timestamp >= parseDateTime64BestEffort\(\{range_from:String\}, 9, 'UTC'\)/);
    assert.match(where, /Timestamp < parseDateTime64BestEffort\(\{range_to:String\}, 9, 'UTC'\)/);
    assert.strictEqual(params.get('param_range_from'), '2026-11-01T10:00:00.000Z');
});

test('the lines show the moment they land, while the volume and the labels are still counted', async function () {
    const page = page_start();
    const search = page.app.runSearch();
    assert.deepStrictEqual(page.parts(), ['rows', 'volume', 'labels']);
    assert.deepStrictEqual(plain(page.app.loading), {rows: true, volume: true, labels: true});
    assert.deepStrictEqual(plain(page.app.histogram), [], 'never the bars of the range before');

    page.answer('rows', [row_json('2026-11-01 10:59:00.000000000', 'hello')]);
    await settled();
    assert.strictEqual(page.app.rows.length, 1);
    assert.deepStrictEqual(plain(page.app.loading), {rows: false, volume: true, labels: true});

    page.answer('volume', [{bucket: 1793530740, count: 1}]);
    page.answer('labels', [{name: 'service', value: 'notes', hits: 1, value_count: 1}]);
    assert.strictEqual(await search, true);
    assert.deepStrictEqual(plain(page.app.loading), {rows: false, volume: false, labels: false});
    assert.strictEqual(page.app.labelCatalog[0].name, 'service');
});

// A page that holds the viewer in a frame, `?embed=1`, gets the lines alone: their volume and
// their labels are never asked for, and the address the viewer writes back stays the small view,
// in the theme the page asked for
test('the small view asks for the lines alone, and its address stays the small view', async function () {
    const page = page_start('?embed=1&theme=light&label=service:clock&range=24h');
    assert.strictEqual(page.app.embed, true);
    const search = page.app.runSearch();
    assert.deepStrictEqual(page.parts(), ['rows']);
    assert.deepStrictEqual(plain(page.app.loading), {rows: true, volume: false, labels: false});
    page.answer('rows', [row_json('2026-11-01 10:59:00.000000000', 'tick 1')]);
    assert.strictEqual(await search, true);
    assert.deepStrictEqual(page.parts(), ['rows'], 'nothing more once the lines are in');
    page.sync();
    const written = new URL(page.urls[page.urls.length - 1]).searchParams;
    assert.strictEqual(written.get('embed'), '1');
    assert.strictEqual(written.get('theme'), 'light');
});

test('a range picked again lets go of every request of the older one', async function () {
    const page = page_start();
    const older = page.app.runSearch();
    const first = page.calls.slice();
    page.answer('rows', [row_json('2026-11-01 10:59:00.000000000', 'older')]);
    await settled();

    page.app.activeRange = '7d';
    page.app.rangeFrom = '2026-10-25T11:00';
    const newer = page.app.runSearch();
    assert.strictEqual(await older, false);
    assert.deepStrictEqual(first.map(v => v.signal.aborted), [true, true, true], 'the volume and the labels still asked are let go, and ClickHouse drops their queries');
    assert.deepStrictEqual(plain(page.app.rows), [], 'and nothing of the older range stays');

    const fresh = page.calls.filter(v => !first.includes(v));
    assert.deepStrictEqual(fresh.map(v => v.part), ['rows', 'volume', 'labels']);
    assert.deepStrictEqual(fresh.map(v => v.signal.aborted), [false, false, false]);
    for (const call of fresh) {
        call.answer([]);
    }
    assert.strictEqual(await newer, true);
});

test('a failed part is said in its own place, and the others still show', async function () {
    const page = page_start();
    const search = page.app.runSearch();
    page.answer('rows', [row_json('2026-11-01 10:59:00.000000000', 'hello')]);
    page.fail('labels', 'Timeout exceeded: elapsed 30.000154 seconds, maximum: 30. (TIMEOUT_EXCEEDED)');
    page.answer('volume', []);
    assert.strictEqual(await search, true);
    assert.strictEqual(page.app.rows.length, 1);
    assert.match(page.app.loadErrors.labels, /^Timeout exceeded/);
    assert.deepStrictEqual(plain(page.app.loading), {rows: false, volume: false, labels: false});
});

test('a live poll is one at a time, and one a new range overtook changes nothing', async function () {
    const page = page_start();
    const search = page.app.runSearch();
    page.answer('rows', [row_json('2026-11-01 10:59:00.000000000', 'hello')]);
    page.answer('volume', []);
    page.answer('labels', []);
    await search;

    page.app.followLive = true;
    page.app.pollNewer();
    page.app.pollNewer();
    assert.strictEqual(page.calls.filter(v => !v.done).length, 1, 'a second poll does not start beside the first');
    const poll = page.calls.find(v => !v.done);

    page.app.activeRange = '7d';
    page.app.rangeFrom = '2026-10-25T11:00';
    page.app.runSearch();
    const active = page.app.active;
    assert.strictEqual(poll.signal.aborted, true);
    await settled();
    assert.strictEqual(page.app.active, active, 'the range of the poll is not put back');
    assert.strictEqual(page.app.polling, false);
});

// The page's app as Vue would make it: its data, its methods, its computed values as getters
// The page as opened on an address: `search` its query, `?embed=1&…`; every address it writes
// back is in `urls`
function page_start(search = '')
{
    const calls = [];
    const urls = [];
    let options = null;
    const window = {
        location: {search, href: `http://127.0.0.1/${search}`, pathname: '/'},
        history: {replaceState: (state, title, url) => urls.push(String(url))},
        addEventListener: function () {},
        removeEventListener: function () {},
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        matchMedia: () => ({matches: false, addEventListener: function () {}}),
    };
    const context = {
        Vue: {
            createApp: function (value) {
                options = value;
                return {mount: function () {}};
            },
            h: function () {},
            Fragment: null,
        },
        window,
        localStorage: {getItem: () => null, setItem: function () {}},
        document: {addEventListener: function () {}, documentElement: {dataset: {}}},
        fetch: function (url, init) {
            return clickhouse_fake(calls, url, init);
        },
        URL,
        URLSearchParams,
        AbortController,
        performance,
        // What the page tells the developer about a failed query is not this test's output
        console: {log: console.log, warn: function () {}, error: function () {}},
        Intl,
    };
    vm.runInNewContext(fs.readFileSync(APP_JS, 'utf8'), context);
    const app = Object.assign(options.data.call({}), {
        $refs: {},
        $nextTick: function (fn) {
            return Promise.resolve().then(fn);
        },
    });
    for (const [name, fn] of Object.entries(options.computed)) {
        Object.defineProperty(app, name, {get: fn.bind(app)});
    }
    for (const [name, fn] of Object.entries(options.methods)) {
        app[name] = fn.bind(app);
    }
    const sync = app.syncUrlState;
    app.syncUrlState = function () {};
    app.scrollAfterSearch = function () {};
    app.showToast = function () {};
    app.activeRange = '1h';
    app.followLive = false;
    app.rangeFrom = '2026-11-01T10:00';
    app.rangeTo = '2026-11-01T11:00';
    const out = {
        app,
        calls,
        urls,
        // The address written back as a search that landed writes it
        sync,
        parts: () => calls.map(v => v.part),
        answer: (part, rows) => calls.find(v => (v.part === part) && !v.done).answer(rows),
        fail: (part, text) => calls.find(v => (v.part === part) && !v.done).fail(text),
    };
    pages.push(out);
    return out;
}

// ClickHouse as the page's fetch sees it: a query waits for its answer, and a request the page
// lets go fails at once as fetch makes it fail
function clickhouse_fake(calls, url, init)
{
    return new Promise(function (resolve, reject) {
        const sql = init.body;
        const call = {
            part: sql.includes('ARRAY JOIN') ? 'labels' : (sql.includes('toStartOfInterval') ? 'volume' : 'rows'),
            signal: init.signal,
            done: false,
            answer: function (rows) {
                call.done = true;
                resolve({ok: true, status: 200, text: async () => rows.map(v => JSON.stringify(v)).join('\n')});
            },
            fail: function (text) {
                call.done = true;
                resolve({ok: false, status: 500, text: async () => `Code: 159. DB::Exception: ${text}`});
            },
        };
        calls.push(call);
        init.signal?.addEventListener('abort', function () {
            call.done = true;
            reject(Object.assign(new Error('The operation was aborted.'), {name: 'AbortError'}));
        });
    });
}

function row_json(time, body)
{
    return {cursor: time, time_utc: time, timestamp_ms: Date.parse(`${time.slice(0, 23).replace(' ', 'T')}Z`), service: 'notes', severity: '', body, stream: 'stdout', subject: '', group_uid: '', parent_group_uid: '', image: '', container_id: '', resource: {}};
}

// A value of the page's own realm, compared as plain data
function plain(value)
{
    return JSON.parse(JSON.stringify(value));
}

// Every promise already answered has run its handlers
function settled()
{
    return new Promise(v => setImmediate(v));
}
