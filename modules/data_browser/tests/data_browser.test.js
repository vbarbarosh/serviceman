const assert = require('assert');
const node_module = require('module');
const path = require('path');
const test = require('node:test');
const url = require('url');
const {createSSRApp} = require('vue');
const {renderToString} = require('vue/server-renderer');

// The component imports the host's helpers from its own base, '../../format_bytes.js', which a
// browser reads at the page's root: here, from serviceman's page
const PUBLIC = path.join(__dirname, '..', '..', '..', 'src', 'main', 'public');
const UI = url.pathToFileURL(path.join(__dirname, '..', 'ui')).href;
node_module.registerHooks({
    resolve: function (specifier, context, next) {
        if (specifier.startsWith('../../') && (context.parentURL !== undefined) && context.parentURL.startsWith(UI)) {
            return next(url.pathToFileURL(path.join(PUBLIC, specifier.slice('../../'.length))).href, context);
        }
        return next(specifier, context);
    },
});

// The page shown is the one its own query found: a query refused leaves it, dimmed, with what
// found it. A query's rows (another table's, a join's) get no Edit or Delete by the open table's
// key after a Find is refused; an empty page says nothing of the refused query, whose words are
// said above it; its pages, ‹ ›, are those of the query shown, not the one refused.
test('a query refused leaves the page shown with the query that found it, and its rows\' acts', async function (t) {
    const data_browser = (await import('../ui/data_browser.js')).default;
    storage_kept(t);
    const asks = [];
    t.mock.method(globalThis, 'fetch', async function (address) {
        const asked = new URL(address, 'http://page');
        asks.push(`${asked.pathname.slice('/b/'.length)} ${asked.searchParams.get('filter') || asked.searchParams.get('pipeline') || ''} ${asked.searchParams.get('skip')}`);
        if (asked.searchParams.get('filter') === 'status =') {
            return answer(400, {error: 'syntax error at or near ")"'});
        }
        if (asked.pathname === '/b/aggregate') {
            const items = [{id: 1, customer: 'ann@example.com'}, {id: 2, customer: 'bob@example.com'}];
            return answer(200, {items, columns: ['id', 'customer'], count: null, more: true, skip: Number(asked.searchParams.get('skip')), limit: 2, took_ms: 1, cut: false});
        }
        const items = (asked.searchParams.get('filter') === 'n < 0') ? [] : [{id: 1, n: 7919}];
        return answer(200, {items, columns: ['id', 'n'], count: items.length, more: false, skip: 0, limit: 50, took_ms: 1, cut: false});
    });
    const vm = vm_of(data_browser, {base: '/b', engine: 'postgresql'});
    vm.collections = [{name: 'big', type: 'table', count: 1000000, estimated: true, bytes: 1, indexes: 1, key: ['id']}];
    vm.open = 'big';

    // A query of another table's rows: read alone, no Edit by big's key
    vm.mode = 'aggregate';
    vm.pipeline = 'SELECT id, customer FROM orders';
    await read(vm.find);
    vm.picked = 0;
    assert.deepStrictEqual([vm.asked.mode, vm.picked_changeable, vm.picked_name], ['aggregate', false, 'A row']);

    // A Find refused: the query's rows stay, said as such, still with no Edit or Delete; › reads
    // the query's next page
    vm.picked = null;
    vm.mode = 'find';
    vm.filter = 'status = ';
    await read(vm.find);
    vm.picked = 0;
    assert.deepStrictEqual([vm.error, vm.asked.mode, vm.asked.pipeline, vm.picked_changeable, vm.picked_name, vm.page.items[0].customer], ['syntax error at or near ")"', 'aggregate', 'SELECT id, customer FROM orders', false, 'A row', 'ann@example.com']);
    vm.picked = null;
    await read(vm.page_go, 1);
    assert.deepStrictEqual(asks, ['aggregate SELECT id, customer FROM orders 0', 'documents status = 0', 'aggregate SELECT id, customer FROM orders 2']);

    // A Find of big's rows: a row of its own has Edit; one that finds none says so
    vm.filter = '';
    await read(vm.find);
    vm.picked = 0;
    assert.deepStrictEqual([vm.error, vm.asked.mode, vm.picked_changeable, vm.picked_name], ['', 'find', true, 'id = 1']);
    vm.picked = null;
    vm.filter = 'n < 0';
    await read(vm.find);
    assert.deepStrictEqual([vm.page.items.length, vm.empty_text], [0, 'No row matches the condition.']);

    // A query refused over it: the empty page under it says nothing of the query refused
    vm.filter = 'status = ';
    await read(vm.find);
    assert.deepStrictEqual([vm.error, vm.asked.filter, vm.empty_text], ['syntax error at or near ")"', 'n < 0', '']);

    // A header clicked on a find's page, the Query tab open: it finds, sorted by that column
    vm.mode = 'aggregate';
    vm.filter = '';
    await read(vm.sort_by, 'n');
    assert.deepStrictEqual([vm.asked.mode, vm.asked.sort, vm.sort_arrow('n')], ['find', '"n" ASC', ' ↑']);
});

// A table too big to count with the list (SQLite's, never ANALYZEd) or counted by an estimate
// (PostgreSQL's, MySQL's) is said by its page's count once a page of it is read with no condition:
// in the list and the head, read again or not. A condition's count never goes there, nor a view's.
test('the open table\'s rows, counted by its page with no condition, are said in the list and the head', async function (t) {
    const data_browser = (await import('../ui/data_browser.js')).default;
    storage_kept(t);
    let listed = [];
    t.mock.method(globalThis, 'fetch', async function (address) {
        const asked = new URL(address, 'http://page');
        if (asked.pathname === '/b/collections') {
            return answer(200, {items: listed.map(v => Object.assign({}, v))});
        }
        const count = (asked.searchParams.get('collection') === 'paid') ? 4 : ((asked.searchParams.get('filter') === '') ? 1000000 : 3);
        return answer(200, {items: [{id: 1}], columns: ['id'], count, more: false, skip: 0, limit: 50, took_ms: 1, cut: false});
    });
    listed = [{name: 'big', type: 'table', count: null, estimated: false, bytes: 85524480, indexes: 1}, {name: 'paid', type: 'view', count: null, estimated: false, bytes: null, indexes: null}];
    const vm = vm_of(data_browser, {base: '/b', engine: 'sqlite'});
    await read(vm.collections_read);
    assert.deepStrictEqual([vm.count_short(vm.collections[0]), vm.collections_shown.length], ['', 2]);
    await read(vm.collection_open, 'big');
    assert.deepStrictEqual([vm.count_short(vm.collections[0]), vm.open_facts], ['1.0M', '1,000,000 rows · 81.6MB · 1 index']);

    // Found by a condition: its 3 are said by the page alone
    vm.filter = 'n < 10';
    await read(vm.find);
    assert.deepStrictEqual([vm.page.count, vm.open_facts], [3, '1,000,000 rows · 81.6MB · 1 index']);
    // The list read again under it says what its engine says; with no condition, the page's again
    await read(vm.collections_read);
    assert.strictEqual(vm.open_facts, 'many rows · 81.6MB · 1 index');
    vm.filter = '';
    await read(vm.find);
    await read(vm.collections_read);
    assert.strictEqual(vm.open_facts, '1,000,000 rows · 81.6MB · 1 index');

    // An estimate is the page's count, no longer said as one
    listed = [{name: 'big', type: 'table', count: 994876, estimated: true, bytes: 94175232, indexes: 1}];
    const sql = vm_of(data_browser, {base: '/b', engine: 'postgresql'});
    await read(sql.collections_read);
    assert.deepStrictEqual([sql.count_short(sql.collections[0]), sql.open_facts], ['~995K', '']);
    await read(sql.collection_open, 'big');
    assert.deepStrictEqual([sql.count_short(sql.collections[0]), sql.open_facts], ['1.0M', '1,000,000 rows · 89.8MB · 1 index']);

    // A view's page counts its rows, and says them; the list says it is a view
    await read(vm.collection_open, 'paid');
    assert.deepStrictEqual([vm.page.count, vm.collections[1].count, vm.open_facts], [4, null, 'a view']);
});

// The document shown whole says what it is one of: the collection, or what the query or the
// pipeline made, which is none of its own
test('a row shown whole is one of the table, or of the query\'s', async function (t) {
    const data_browser = (await import('../ui/data_browser.js')).default;
    storage_kept(t);
    t.mock.method(globalThis, 'fetch', async () => answer(200, {items: [{_id: 1, id: 1}], columns: undefined, count: null, more: false, skip: 0, limit: 50, took_ms: 1, cut: false}));
    const said = [];
    for (const engine of ['postgresql', 'mongodb']) {
        const vm = vm_of(data_browser, {base: '/b', engine});
        vm.collections = [{name: 'big', type: 'table', count: 1, bytes: 1, indexes: 1, key: ['id']}];
        await read(vm.collection_open, 'big');
        vm.picked = 0;
        said.push(vm.picked_from);
        vm.mode = 'aggregate';
        await read(vm.find);
        vm.picked = 0;
        said.push(vm.picked_from);
    }
    assert.deepStrictEqual(said, ['big', 'the query\'s', 'big', 'the pipeline\'s']);
});

// ‹‹ First and Last ›› beside ‹ ›, as the page draws them, where the rows were counted: First
// disabled on the first page, as ‹ is, and Last on the page that holds the last row, as › is,
// which it reads at the page size chosen. A query's page, and a find whose count was stopped,
// have neither; a table of one page and one with no row have every button disabled.
test('First and Last: disabled on the first and the last page, only where the rows were counted', async function (t) {
    const data_browser = (await import('../ui/data_browser.js')).default;
    storage_kept(t);
    const found = {count: 1000000, counted: true, cut: null};
    const asks = [];
    t.mock.method(globalThis, 'fetch', async function (address) {
        const asked = new URL(address, 'http://page');
        const skip = Number(asked.searchParams.get('skip'));
        const limit = Number(asked.searchParams.get('limit'));
        asks.push(`${asked.pathname.slice('/b/'.length)} ${skip} ${limit}`);
        if (asked.pathname === '/b/aggregate') {
            return answer(200, {items: rows_of(skip, limit), columns: ['id'], count: null, more: true, skip, limit, took_ms: 1, cut: false});
        }
        // A page of large rows is cut at 4 MB, the rest of it left for ›
        const cut = (found.cut !== null) && (found.cut < Math.min(limit, found.count - skip));
        const items = rows_of(skip, cut ? found.cut : Math.min(limit, found.count - skip));
        return answer(200, {items, columns: ['id'], count: (found.counted ? found.count : null), more: ((skip + items.length) < found.count), skip, limit, took_ms: 1, cut});
    });
    const vm = vm_of(data_browser, {base: '/b', engine: 'postgresql'});
    vm.collections = [{name: 'big', type: 'table', count: 1000000, estimated: false, bytes: 1, indexes: 1, key: ['id']}];

    // The first page: First and ‹ disabled; Last says where it goes
    await read(vm.collection_open, 'big');
    assert.deepStrictEqual(await pager_of(data_browser, vm), ['‹‹ First disabled', '‹ disabled', '›', 'Last ›› The last page: 999,951–1,000,000']);
    // The last: 999,950 past the first row, at 50 a page; › and Last disabled
    await read(vm.click_last);
    assert.deepStrictEqual([asks.at(-1), vm.range_text], ['documents 999950 50', '999,951–1,000,000 of 1,000,000']);
    assert.deepStrictEqual(await pager_of(data_browser, vm), ['‹‹ First', '‹', '› disabled', 'Last ›› disabled The last page: 999,951–1,000,000']);
    // A page between: every button
    await read(vm.page_go, -1);
    assert.deepStrictEqual([asks.at(-1), await pager_of(data_browser, vm)], ['documents 999900 50', ['‹‹ First', '‹', '›', 'Last ›› The last page: 999,951–1,000,000']]);
    await read(vm.click_first);
    assert.deepStrictEqual([asks.at(-1), vm.range_text], ['documents 0 50', '1–50 of 1,000,000']);

    // The last page cut at 4 MB: Last is where it begins, and › reads the rest of it
    found.cut = 20;
    await read(vm.click_last);
    assert.deepStrictEqual([asks.at(-1), vm.range_text, await pager_of(data_browser, vm)], ['documents 999950 50', '999,951–999,970 of 1,000,000', ['‹‹ First', '‹', '›', 'Last ›› disabled The last page: 999,951–1,000,000']]);
    await read(vm.page_go, 1);
    assert.deepStrictEqual([asks.at(-1), vm.range_text], ['documents 999970 50', '999,971–999,990 of 1,000,000']);
    found.cut = null;

    // 200 a page: the last page is the last 200 rows; a count that is not a whole number of
    // pages, its last row alone
    vm.limit = 200;
    await read(vm.documents_read, 0);
    await read(vm.click_last);
    assert.deepStrictEqual([asks.at(-1), vm.range_text], ['documents 999800 200', '999,801–1,000,000 of 1,000,000']);
    found.count = 1000001;
    await read(vm.click_first);
    await read(vm.click_last);
    assert.deepStrictEqual([asks.at(-1), vm.range_text], ['documents 1000000 200', '1,000,001–1,000,001 of 1,000,001']);

    // Its count stopped at 5 s: no First and no Last, nor on a query's page, which is not counted
    found.counted = false;
    await read(vm.page_go, -1);
    assert.deepStrictEqual(await pager_of(data_browser, vm), ['‹', '›']);
    vm.mode = 'aggregate';
    vm.pipeline = 'SELECT id FROM big';
    await read(vm.find);
    await read(vm.page_go, 1);
    assert.deepStrictEqual([asks.at(-1), await pager_of(data_browser, vm)], ['aggregate 200 200', ['‹', '›']]);

    // A table of one page: nothing to go to, nor in one with no row
    found.count = 30;
    found.counted = true;
    vm.mode = 'find';
    await read(vm.find);
    assert.deepStrictEqual([vm.range_text, await pager_of(data_browser, vm)], ['1–30 of 30', ['‹‹ First disabled', '‹ disabled', '› disabled', 'Last ›› disabled The last page: 1–30']]);
    found.count = 0;
    await read(vm.find);
    assert.deepStrictEqual([vm.range_text, await pager_of(data_browser, vm)], ['0 rows', ['‹‹ First disabled', '‹ disabled', '› disabled', 'Last ›› disabled']]);
});

// The rows counted changed since the page shown counted them. Last reads where that count puts
// the last page; with rows deleted, that is past the end, and the page that holds the last row
// now is read in its place, once: the rows there are, never an empty page or an error. Rows
// added, Last reads on to the new last page. A page found past the end any other way, by ›
// or by the page read again once its only row is deleted, is read again as Last is. A query's
// page, not counted, says none are past its end.
test('Last with rows deleted or added since they were counted: the page that holds the last row now', async function (t) {
    const data_browser = (await import('../ui/data_browser.js')).default;
    storage_kept(t);
    const found = {count: 1000000};
    const asks = [];
    t.mock.method(globalThis, 'fetch', async function (address) {
        const asked = new URL(address, 'http://page');
        if (asked.pathname === '/b/collections') {
            return answer(200, {items: [{name: 'big', type: 'table', count: found.count, estimated: false, bytes: 1, indexes: 1, key: ['id']}]});
        }
        const skip = Number(asked.searchParams.get('skip'));
        const limit = Number(asked.searchParams.get('limit'));
        asks.push(`${asked.pathname.slice('/b/'.length)} ${skip}`);
        if (asked.pathname === '/b/aggregate') {
            const rows = rows_of(skip, Math.min(limit, found.count - skip));
            return answer(200, {items: rows, columns: ['id'], count: null, more: ((skip + rows.length) < found.count), skip, limit, took_ms: 1, cut: false});
        }
        const items = rows_of(skip, Math.min(limit, found.count - skip));
        return answer(200, {items, columns: ['id'], count: found.count, more: ((skip + items.length) < found.count), skip, limit, took_ms: 1, cut: false});
    });
    const vm = vm_of(data_browser, {base: '/b', engine: 'mysql'});
    vm.collections = [{name: 'big', type: 'table', count: 1000000, estimated: false, bytes: 1, indexes: 1, key: ['id']}];
    await read(vm.collection_open, 'big');

    // 100 rows deleted meanwhile: 999,950 is past the end, and 999,850 is read in its place
    found.count = 999900;
    asks.length = 0;
    await read(vm.click_last);
    assert.deepStrictEqual([asks, vm.error, vm.range_text], [['documents 999950', 'documents 999850'], '', '999,851–999,900 of 999,900']);
    assert.deepStrictEqual(await pager_of(data_browser, vm), ['‹‹ First', '‹', '› disabled', 'Last ›› disabled The last page: 999,851–999,900']);
    // Deleted down to 30: the first page is the last
    await read(vm.click_first);
    found.count = 30;
    asks.length = 0;
    await read(vm.click_last);
    assert.deepStrictEqual([asks, vm.range_text], [['documents 999850', 'documents 0'], '1–30 of 30']);

    // 110 rows added meanwhile: the old last page is not the last, and the new one is read
    found.count = 1000000;
    await read(vm.click_first);
    found.count = 1000110;
    asks.length = 0;
    await read(vm.click_last);
    assert.deepStrictEqual([asks, vm.range_text], [['documents 999950', 'documents 1000100'], '1,000,101–1,000,110 of 1,000,110']);

    // › past the end, the rows after this page deleted meanwhile: the last page there is now
    await read(vm.click_first);
    found.count = 40;
    asks.length = 0;
    await read(vm.page_go, 1);
    assert.deepStrictEqual([asks, vm.range_text], [['documents 50', 'documents 0'], '1–40 of 40']);

    // The last page's only row deleted: the page read again is the one before it
    found.count = 51;
    await read(vm.click_first);
    await read(vm.click_last);
    assert.strictEqual(vm.range_text, '51–51 of 51');
    found.count = 50;
    asks.length = 0;
    await read(vm.changed, 'Deleted id = 51');
    assert.deepStrictEqual([asks, vm.said, vm.range_text], [['documents 50', 'documents 0'], 'Deleted id = 51', '1–50 of 50']);

    // A query's page past its end, the rows it found deleted meanwhile: nothing counted, nothing
    // read again
    found.count = 100;
    vm.mode = 'aggregate';
    vm.pipeline = 'SELECT id FROM big';
    await read(vm.find);
    found.count = 20;
    asks.length = 0;
    await read(vm.page_go, 1);
    assert.deepStrictEqual([asks, vm.range_text], [['aggregate 50'], 'none past 50']);
});

// + Row's foot names the columns its table fills itself, one with its default
test('+ Row says which columns their defaults fill, one or many', async function () {
    const data_browser = (await import('../ui/data_browser.js')).default;
    const vm = vm_of(data_browser, {base: '/b', engine: 'mysql'});
    vm.editing = {id: undefined, text: '{}', was: undefined, busy: false, error: '', changed: null, filled: ['id']};
    assert.strictEqual(vm.edit_hint, 'A JSON object of the columns to set, null for NULL; id: its default. Ctrl+Enter adds.');
    vm.editing.filled = ['id', 'placed'];
    assert.strictEqual(vm.edit_hint, 'A JSON object of the columns to set, null for NULL; id, placed: their defaults. Ctrl+Enter adds.');
    vm.editing.filled = [];
    assert.strictEqual(vm.edit_hint, 'A JSON object of the columns to set, null for NULL; their defaults fill the rest. Ctrl+Enter adds.');
});

// The component's data, its props, its computed parts and its methods on one object, as Vue
// gives them to its template; $emit, $nextTick and $refs do nothing here
function vm_of(component, props)
{
    const vm = Object.assign(component.data(), props, {$emit: function () {}, $nextTick: function () {}, $refs: {}});
    for (const [key, method] of Object.entries(component.methods)) {
        vm[key] = method.bind(vm);
    }
    for (const [key, computed] of Object.entries(component.computed)) {
        Object.defineProperty(vm, key, {get: () => computed.call(vm)});
    }
    return vm;
}

// The page's ‹‹ First ‹ › Last ›› as Vue draws them for the state `vm` holds: each one's text,
// `disabled` after one that is, and its title
async function pager_of(component, vm)
{
    const state = {};
    for (const key of Object.keys(component.data())) {
        state[key] = vm[key];
    }
    const app = createSSRApp(Object.assign({}, component, {data: () => state}), {base: vm.base, engine: vm.engine});
    const html = await renderToString(app);
    const pager = html.slice(html.indexOf('<span class="dbr-pager">'), html.indexOf('</span>', html.indexOf('<span class="dbr-pager">')));
    const out = [];
    for (const button of pager.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)) {
        const title = /title="([^"]*)"/.exec(button[1]);
        out.push([button[2], / disabled[ >]/.test(`${button[1]}>`) ? 'disabled' : '', (title === null) ? '' : title[1]].filter(v => v !== '').join(' '));
    }
    return out;
}

// Rows `id` skip + 1 on, `count` of them, none for less than one
function rows_of(skip, count)
{
    const out = [];
    for (let i = 0; i < count; ++i) {
        out.push({id: skip + i + 1});
    }
    return out;
}

// This browser's storage, for the test alone: the last queries are kept in it
function storage_kept(t)
{
    const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const kept = new Map();
    const storage = {getItem: v => (kept.has(v) ? kept.get(v) : null), setItem: (name, value) => kept.set(name, String(value)), removeItem: v => kept.delete(v)};
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, get: () => storage});
    t.after(function () {
        if (before === undefined) {
            delete globalThis.localStorage;
        }
        else {
            Object.defineProperty(globalThis, 'localStorage', before);
        }
    });
}

// A method that reads, called, and what it read answered: the page's fetch, then its JSON
async function read(method, ...args)
{
    method(...args);
    await new Promise(v => setImmediate(v));
}

function answer(status, body)
{
    return {ok: (status < 400), status, json: async () => body};
}
