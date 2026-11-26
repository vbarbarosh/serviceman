const assert = require('assert');
const node_module = require('module');
const path = require('path');
const test = require('node:test');
const url = require('url');

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
