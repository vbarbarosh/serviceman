const assert = require('assert');
const test = require('node:test');

// The underline of a row of tabs stays under the open tab when the row changes after the page
// opened: a machine's Services and Databases counts arrive later and widen the tabs before
// Files, a skin's faces make every tab wider, a tab is shown or gone. Measured again with no
// slide; a pick still slides. A tab under More ▾ is measured from the row, through its wrapper.
test('a tab\'s underline follows its tab when the row changes under it', async function (t) {
    const tab_ink = (await import('../src/main/public/tab_ink.js')).default;
    const observers = fake_observers(t);
    const frames = [];
    globalThis.requestAnimationFrame = function (fn) {
        frames.push(fn);
    };
    t.after(() => delete globalThis.requestAnimationFrame);
    function frames_run() {
        while (frames.length > 0) {
            frames.shift()();
        }
    }

    // Overview, Databases and Files, Files open; the line is the row's last element
    const row = {children: [], querySelector: () => row.children.flatMap(v => [v].concat(v.children || [])).find(v => v.on) || null};
    const overview = {offsetParent: row, offsetLeft: 49, offsetTop: 0, offsetHeight: 40, offsetWidth: 112, on: false};
    const databases = {offsetParent: row, offsetLeft: 184, offsetTop: 0, offsetHeight: 40, offsetWidth: 120, on: false};
    const files = {offsetParent: row, offsetLeft: 327, offsetTop: 0, offsetHeight: 40, offsetWidth: 76, on: true};
    row.children.push(overview, databases, files);
    const ink = {parentElement: row};
    row.children.push(ink);
    // Its methods bound to it, as Vue binds them: the line hands them on as callbacks
    const vm = Object.assign(tab_ink.data(), {$el: ink, $nextTick: v => v()});
    for (const [key, method] of Object.entries(tab_ink.methods)) {
        vm[key] = method.bind(vm);
    }
    tab_ink.mounted.call(vm);
    assert.deepStrictEqual([vm.left, vm.top, vm.width, vm.still], [327, 39, 76, true], 'under its tab at once, with no slide');
    frames_run();
    assert.strictEqual(vm.still, false, 'a pick slides from then on');
    assert.deepStrictEqual(observers.sizes.watched, [row, overview, databases, files], 'the row and every tab, the line left out');
    assert.deepStrictEqual(observers.tabs.watched, [{target: row, options: {childList: true}}]);

    // Databases' count arrives: Files moves right by its width, and the line goes with it at
    // once, then slides again at the next pick
    databases.offsetWidth = 148;
    files.offsetLeft = 355;
    observers.sizes.fire();
    assert.deepStrictEqual([vm.left, vm.width, vm.still], [355, 76, true]);
    frames_run();
    assert.strictEqual(vm.still, false);

    // A skin's faces: Files itself wider
    files.offsetWidth = 81;
    observers.sizes.fire();
    assert.deepStrictEqual([vm.left, vm.width], [355, 81]);

    // A tab shown after Files is watched too
    const logs = {offsetParent: row, offsetLeft: 460, offsetTop: 0, offsetHeight: 40, offsetWidth: 77, on: false};
    row.children.splice(3, 0, logs);
    observers.tabs.fire();
    assert.deepStrictEqual(observers.sizes.watched, [row, overview, databases, files, logs]);

    // The row wrapped on a narrow page: Files on the second line
    Object.assign(files, {offsetLeft: 0, offsetTop: 40});
    observers.sizes.fire();
    assert.deepStrictEqual([vm.left, vm.top], [0, 79]);
    frames_run();

    // A pick is the mark: it slides, and no tab open takes the line away
    files.on = false;
    logs.on = true;
    tab_ink.watch.mark.call(vm);
    assert.deepStrictEqual([vm.left, vm.width, vm.still], [460, 77, false]);

    // A tab under More ▾: its button sits in a wrapper of its own, which its offsets start
    // from, and the line is under it, not at the row's start
    const wrap = {offsetParent: row, offsetLeft: 560, offsetTop: 0, offsetHeight: 40, offsetWidth: 110, on: false, children: []};
    const more = {offsetParent: wrap, offsetLeft: 0, offsetTop: 0, offsetHeight: 40, offsetWidth: 110, on: false};
    wrap.children.push(more);
    row.children.splice(4, 0, wrap);
    observers.tabs.fire();
    logs.on = false;
    more.on = true;
    tab_ink.watch.mark.call(vm);
    assert.deepStrictEqual([vm.left, vm.top, vm.width], [560, 39, 110]);

    more.on = false;
    observers.sizes.fire();
    assert.strictEqual(vm.width, 0);

    tab_ink.unmounted.call(vm);
    assert.deepStrictEqual([observers.sizes.watched, observers.tabs.watched], [[], []]);
});

// ResizeObserver and MutationObserver as the test drives them: what each watches now, and its
// callback fired by hand
function fake_observers(t)
{
    const out = {};
    function fake(key) {
        return class {
            constructor(callback) {
                this.callback = callback;
                this.watched = [];
                out[key] = this;
            }
            observe(target, options) {
                this.watched.push((options === undefined) ? target : {target, options});
            }
            disconnect() {
                this.watched = [];
            }
            fire() {
                this.callback([]);
            }
        };
    }
    globalThis.ResizeObserver = fake('sizes');
    globalThis.MutationObserver = fake('tabs');
    t.after(function () {
        delete globalThis.ResizeObserver;
        delete globalThis.MutationObserver;
    });
    return out;
}
