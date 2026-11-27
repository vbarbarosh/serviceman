const assert = require('assert');
const node_module = require('module');
const path = require('path');
const test = require('node:test');
const url = require('url');

// The component imports the host's table from its own base, '../../data_table.js', which a
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

// A folder opened from the list starts at its top, wherever the one before it was scrolled to:
// the list's own scroll where it scrolls itself (a pane), the page's where the page scrolls it
// (a phone), and nothing moves while its top is in view. The same folder read again, after a
// change in it, stays where it was.
test('a folder opened from the list starts at its top, and the same folder read again stays', async function (t) {
    // Its uploads ask the window before it closes, from the moment they are loaded
    globalThis.addEventListener = function () {};
    t.after(() => delete globalThis.addEventListener);
    const file_manager = (await import('../ui/file_manager.js')).default;
    t.mock.method(globalThis, 'fetch', async function (address) {
        const where = new URL(address, 'http://page').searchParams.get('path');
        const items = (where === '/a') ? [{name: 'deep', kind: 'dir', size: null, mtime_ms: 0}] : [];
        return answer(200, {path: where, items});
    });
    globalThis.getComputedStyle = function (element) {
        return {overflowY: element.overflow_y};
    };
    t.after(() => delete globalThis.getComputedStyle);

    // A pane that scrolls itself, scrolled deep: the folder opened from its list is at its top
    const pane = element_of(null, 400);
    const vm = vm_of(file_manager, {base: '/b', start: '', offline: false}, pane);
    await vm.open('/a');
    pane.scrollTop = 1903;
    vm.row_click({name: 'deep', kind: 'dir'});
    await settled();
    assert.deepStrictEqual([vm.path, pane.scrollTop, pane.brought], ['/a/deep', 0, 0]);

    // The same folder read again, as after a delete in it, stays where it was
    pane.scrollTop = 700;
    await vm.open('/a/deep');
    assert.deepStrictEqual([pane.scrollTop, pane.brought], [700, 0]);

    // A page that scrolls the list, its top gone above the page's: the page is brought to it
    const page = {overflow_y: 'auto', parentElement: null, getBoundingClientRect: () => ({top: 52})};
    const listed = element_of(page, -1400);
    const vm2 = vm_of(file_manager, {base: '/b', start: '', offline: false}, listed);
    await vm2.open('/a');
    vm2.row_click({name: 'deep', kind: 'dir'});
    await settled();
    assert.deepStrictEqual([vm2.path, listed.brought], ['/a/deep', 1]);

    // Its top in view, under the head: the page stays as it is
    const shown = element_of(page, 600);
    const vm3 = vm_of(file_manager, {base: '/b', start: '', offline: false}, shown);
    await vm3.open('/a');
    vm3.row_click({name: 'deep', kind: 'dir'});
    await settled();
    assert.deepStrictEqual([vm3.path, shown.brought], ['/a/deep', 0]);
});

// The file manager's root as the page lays it out: its top `top` px from the window's, in a box
// that scrolls it (`parent`) or in none; `brought` counts the times it was scrolled into view
function element_of(parent, top)
{
    const out = {scrollTop: 0, brought: 0, overflow_y: 'auto', parentElement: parent, getBoundingClientRect: () => ({top})};
    out.scrollIntoView = function (options) {
        assert.deepStrictEqual(options, {block: 'start'});
        out.brought++;
    };
    return out;
}

// The component's data, its props, its computed parts and its methods on one object, as Vue
// gives them to its template; $nextTick runs what it is given at once, $emit does nothing
function vm_of(component, props, element)
{
    const vm = Object.assign(component.data(), props, {$el: element, $emit: function () {}, $nextTick: v => v(), $refs: {}});
    for (const [key, method] of Object.entries(component.methods)) {
        vm[key] = method.bind(vm);
    }
    for (const [key, computed] of Object.entries(component.computed)) {
        Object.defineProperty(vm, key, {get: () => computed.call(vm)});
    }
    return vm;
}

// What a click started has read and drawn
async function settled()
{
    await new Promise(v => setImmediate(v));
}

function answer(status, body)
{
    return {ok: (status < 400), status, json: async () => body};
}
