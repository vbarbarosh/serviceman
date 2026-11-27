const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');

async function categories_of()
{
    return (await import(path.join(PUBLIC, 'categories.js')));
}

// Every page of the page's own, as one text: where each category's head is drawn
function page_text()
{
    return fs.readdirSync(PUBLIC).filter(v => v.endsWith('.js')).map(v => fs.readFileSync(path.join(PUBLIC, v), 'utf8')).join('\n');
}

// The kit draws every category's page with one head, its icon, name and line from CATEGORIES
test('every category has its page head, by its own key', async function () {
    const {default: categories, ALL} = await categories_of();
    const text = page_text();
    for (const item of [...categories, ALL]) {
        assert.match(text, new RegExp(`<page-head category="${item.key}"[ :>/]`), `${item.key} has its head`);
    }
});

// The head ends the line with a full stop of its own, and How it works comes after it
test('a category\'s line is one sentence with no full stop of its own', async function () {
    const {default: categories, ALL} = await categories_of();
    for (const item of [...categories, ALL]) {
        assert.doesNotMatch(item.says, /\.$/, `${item.key}: no full stop`);
        assert.ok(item.says.length <= 100, `${item.key}: one line`);
    }
});

// The kit draws every category's table as its table card: the find box and chips inside it,
// a footer of counts, the empty state; a page that drew a bare table would fall out of the kit
test('every category\'s table is the kit\'s table card', async function () {
    const pages = ['services_pane', 'remotes_pane', 'addresses_pane', 'databases_pane', 'secrets_form', 'tokens_form', 'forwards_section', 'mounts_section', 'load_tests_pane', 'volumes_pane', 'shared_folders_pane'];
    for (const name of pages) {
        const tags = fs.readFileSync(path.join(PUBLIC, `${name}.js`), 'utf8').split('\n').filter(v => v.trim().startsWith('<data-table '));
        const framed = tags.filter(v => / framed /.test(v) && v.includes(':foot="'));
        assert.strictEqual(framed.length, 1, `${name} frames its table, with a footer`);
        assert.match(framed[0], /empty_title="[^"]+"/, `${name} says what would be here`);
    }
});

// A machine's page shows six tabs in its head's foot, as drawn; the rest are under More ▾
test('a machine\'s page shows six tabs, the rest under More', function () {
    const text = fs.readFileSync(path.join(PUBLIC, 'serviceman.js'), 'utf8');
    const found = /const REMOTE_TABS = \[([\s\S]*?)\n\];/.exec(text);
    assert.notStrictEqual(found, null, 'the machine\'s tabs are listed');
    const main = found[1].split('\n').filter(v => v.includes('main: true')).map(v => /key: '([a-z]+)'/.exec(v)[1]);
    assert.deepStrictEqual(main, ['overview', 'services', 'databases', 'files', 'logs', 'settings']);
    assert.match(text, /class="item-card"/, 'its head is the kit\'s card');
});

// A service's head says it once, its tabs in the card's foot: Overview, Logs, Settings, Files, Shell
test('a service\'s page has its tabs in its head\'s card, Settings among them', function () {
    const text = fs.readFileSync(path.join(PUBLIC, 'serviceman.js'), 'utf8');
    const found = /const SERVICE_TABS = \[([\s\S]*?)\n\];/.exec(text);
    assert.notStrictEqual(found, null, 'the service\'s tabs are listed');
    const keys = found[1].split('\n').filter(v => v.includes('key: ')).map(v => /key: '([a-z]+)'/.exec(v)[1]);
    assert.deepStrictEqual(keys, ['overview', 'logs', 'settings', 'files', 'shell']);
});

// A service's Overview shows what no other tab of its page shows, its newest lines: what runs
// and its addresses are its Settings' cards, with Edit there
test('a service\'s Overview shows its newest lines alone, what runs and its addresses on Settings', async function () {
    const overview = (await import(path.join(PUBLIC, 'service_overview.js'))).default;
    assert.deepStrictEqual(overview.props, ['view']);
    assert.match(overview.template, /Its newest lines/);
    assert.doesNotMatch(overview.template, /What runs<\/h2>|Addresses<\/h2>|svc-runs|svc-addr/, 'no card Settings has');
    const vm = {view: {phase: 'running', said: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']}};
    assert.deepStrictEqual(overview.computed.lines.call(vm), ['c', 'd', 'e', 'f', 'g', 'h'], 'the newest six');
});

// Only what serviceman drives prints lines, so only a program or an image has an Overview: a
// folder of files and an app already running open on Settings, whatever tab was picked last
test('a service with no lines of its own has no Overview, and opens on Settings', async function () {
    const service_tab_allowed = (await import(path.join(PUBLIC, 'service_tab_allowed.js'))).default;
    const service_tab_of = (await import(path.join(PUBLIC, 'service_tab_of.js'))).default;
    const program = {type: 'shell', phase: 'running'};
    const image = {type: 'docker', phase: 'stopped'};
    const folder = {type: 'files', phase: 'running'};
    const app = {type: 'external', phase: 'running'};
    const tabs = ['overview', 'logs', 'settings', 'files', 'shell'];
    assert.deepStrictEqual(tabs.filter(v => service_tab_allowed(program, v)), tabs);
    assert.deepStrictEqual(tabs.filter(v => service_tab_allowed(image, v)), ['overview', 'logs', 'settings']);
    assert.deepStrictEqual(tabs.filter(v => service_tab_allowed(folder, v)), ['settings']);
    assert.deepStrictEqual(tabs.filter(v => service_tab_allowed(app, v)), ['settings']);
    assert.deepStrictEqual([service_tab_of(program, 'shell'), service_tab_of(image, 'shell'), service_tab_of(folder, 'overview'), service_tab_of(app, 'logs'), service_tab_of(folder, 'settings')], ['shell', 'overview', 'settings', 'settings', 'settings']);
});

// A machine's Overview shows what no other tab of its page shows: its services are its Services
// tab, the table there and Service here in its head; its agent and its updates are Configure's
// cards, Test the link with them; its logs are its Logs tab
test('a machine\'s Overview has no table of its services, nor a card one of its tabs has', async function () {
    const overview = (await import(path.join(PUBLIC, 'remote_overview.js'))).default;
    assert.doesNotMatch(overview.template, /<services-pane|<data-table/, 'no table of its services');
    assert.strictEqual(overview.components['services-pane'], undefined);
    for (const title of ['Agent', 'Updates', 'Logs']) {
        assert.doesNotMatch(overview.template, new RegExp(`<overview-card [^>]*title="${title}"`), `no ${title} card: a tab has it`);
    }
    assert.match(overview.template, /<overview-card icon="monitor" title="Machine">/, 'the machine\'s own card stays');
    const card = (await import(path.join(PUBLIC, 'overview_card.js'))).default;
    assert.deepStrictEqual(card.props, ['icon', 'title'], 'a card leads to no tab: the tab is the place');
    const text = fs.readFileSync(path.join(PUBLIC, 'serviceman.js'), 'utf8');
    const page = template_of(text, 'remote_page');
    assert.match(page, /<article v-else-if="\(tab_now === 'services'\)" id="detail" class="list"><services-pane /, 'the Services tab keeps the table');
    assert.match(page, /\$emit\('create', view\.name\)[^\n]*Service here/, 'Service here stays in the head');
    const configure = template_of(text, 'remote_configure');
    assert.match(configure, /<button type="button" class="link" @click="link_test_open = true">Test the link<\/button>/, 'Test the link is on Configure\'s Agent card');
    assert.match(configure, /<link-test-panel v-if=/, 'and its test opens there');
    for (const fact of ['Node', 'Runs as', 'Root half']) {
        assert.match(configure, new RegExp(`<dt>${fact}</dt>`), `${fact} moved to Configure's Agent card`);
    }
    assert.match(configure, /<p v-else-if="\(updates\.pending === null\)" class="muted">How many updates wait is not known/, 'Configure says a count apt did not give');
    assert.match(configure, /\{\{ held_said \}\}/, 'and what Ubuntu holds back');
});

// A component's data, computed and methods on one object, as the page reads them
function vm_of(component, fields)
{
    const vm = Object.assign((component.data === undefined) ? {} : component.data(), fields);
    for (const [key, method] of Object.entries(component.methods || {})) {
        vm[key] = method.bind(vm);
    }
    for (const [key, computed] of Object.entries(component.computed || {})) {
        Object.defineProperty(vm, key, {get: () => computed.call(vm)});
    }
    return vm;
}

// A page's template as serviceman.js has it
function template_of(text, name)
{
    const found = new RegExp(`\\nconst ${name} = \\{\\n    template: \`\\n([\\s\\S]*?)\\n\`,`).exec(text);
    assert.notStrictEqual(found, null, `${name} has its template`);
    return found[1];
}

// A machine's and a service's page scroll as one, the crumbs and the head with them; right under
// its card the head folds into a slim row with the same tabs, which takes no room in the page. A
// tab that fills the height (a terminal, a file manager, a service's lines) keeps the page still
// where the screen has room for both.
test('a machine\'s and a service\'s head fold into a slim row as the page scrolls', function () {
    const text = fs.readFileSync(path.join(PUBLIC, 'serviceman.js'), 'utf8');
    const css = fs.readFileSync(path.join(PUBLIC, 'serviceman.css'), 'utf8');
    const pages = {
        remote_page: {slim: /^    <item-slim v-if="\(fills === false\)" :icon="icon" :name="view\.name" :state="state_pill" :facts="head_facts" :tabs="tabs_shown" :more="tabs_more" :tab="tab_now" @tab="\$emit\('tab', \$event\)">$/m, filling: 'REMOTE_TABS_FILLING', fills: ['files', 'shell']},
        service_page: {slim: /^    <item-slim v-if="\(fills === false\)" :icon="kind\.icon" :name="view\.name" :state="state_pill" :facts="head_facts" :tabs="tabs" :tab="tab_now" @tab="\$emit\('tab', \$event\)"\/>$/m, filling: 'SERVICE_TABS_FILLING', fills: ['logs', 'files', 'shell']},
    };
    for (const [name, page] of Object.entries(pages)) {
        const template = template_of(text, name);
        assert.ok(template.startsWith('<div id="page" :class="{fills}">'), `${name} says when it fills`);
        assert.match(template, page.slim, `${name} folds its head with its own tabs`);
        const after_card = template.split('\n').slice(template.split('\n').findIndex(v => /^        <div class="tabbar">$/.test(v)));
        const next = after_card.findIndex(v => /^    <(?!\/div>|!--)/.test(v));
        assert.match(after_card[next], /^    <item-slim /, `${name}: the slim row stands right under the card`);
        const filling = new RegExp(`\\nconst ${page.filling} = \\[([^\\]]*)\\];`).exec(text);
        assert.notStrictEqual(filling, null, `${name} lists the tabs that fill`);
        assert.deepStrictEqual(filling[1].split(', ').map(v => v.replace(/'/g, '')), page.fills);
    }
    assert.match(css, /\nmain > section:has\(> #page:not\(\.fills\)\) \{\n    display: block;\n    overflow-y: auto;\n\}/, 'the section under the bar scrolls, the crumbs in it');
    assert.match(css, /\n#page:not\(\.fills\) > #detail \{\n    overflow: visible;\n\}/, 'the pane does not scroll on its own');
    assert.match(css, /\n\.item-slim \{\n    position: sticky;\n    top: 0;\n    z-index: 10;\n    height: 0;\n\}/, 'the slim row takes no room');
});

// A window under 900 px wide or 720 px tall, a phone among them, has no room for a head and a
// pane that fills the rest: there a filling tab scrolls with the page too, its pane as
// tall as the section (cqh), a folder and a service's lines longer as they grow. The file
// manager's bar and the note under it are one head, which stays at the top of what scrolls the
// list, at every size, while something is ticked or asked; on a phone the bar's right end wraps.
test('on a phone a tab that fills the height scrolls with the page, the file manager\'s bar in view', function () {
    const css = fs.readFileSync(path.join(PUBLIC, 'serviceman.css'), 'utf8');
    const found = /\n@media \(max-width: 900px\), \(max-height: 720px\) \{\n([\s\S]*?)\n\}\n/.exec(css);
    assert.notStrictEqual(found, null, 'a narrow window and a short one have rules of their own');
    assert.match(found[1], /^    main > section:has\(> #page\.fills\) \{\n        container-type: size;\n        display: block;\n        overflow-y: auto;\n    \}$/m, 'the section scrolls, and the panes are measured by it');
    assert.match(found[1], /^    #page\.fills > #detail \{\n        height: 100cqh;\n    \}$/m, 'a terminal takes the screen');
    assert.match(found[1], /^    #page\.fills > #detail\.fm,\n    #page\.fills > #detail\.service-logs \{\n        height: auto;\n        min-height: 100cqh;\n        overflow: visible;\n    \}$/m, 'a folder and the lines take at least the screen, and grow');
    const fm_css = fs.readFileSync(path.join(__dirname, '..', 'modules', 'file_manager', 'ui', 'file_manager.css'), 'utf8');
    assert.match(fm_css, /\n\.fm > \.fm-head:has\(> \.fm-bar\.picked\) \{\n    position: sticky;\n    top: \.45rem;\n/, 'the bar stays in view while something is ticked, at every size');
    assert.match(fm_css, /\n@media \(max-width: 40rem\) \{\n[^@]*?\n    \.fm-bar \.list-right \{\n        flex-wrap: wrap;\n    \}\n/, 'a phone wraps the bar\'s right end');
    // Each bar of the file manager's, the list's and the editor's, opens a head, and every note
    // under a bar is in the head before it closes
    const lines = fs.readFileSync(path.join(__dirname, '..', 'modules', 'file_manager', 'ui', 'file_manager.js'), 'utf8').split('\n');
    const inside = new Set();
    let heads = 0;
    for (let i = 0; i < lines.length; i++) {
        const head = /^( *)<div class="fm-head">$/.exec(lines[i]);
        if (head === null) {
            continue;
        }
        heads++;
        let first = null;
        for (let j = i + 1; lines[j] !== `${head[1]}</div>`; j++) {
            inside.add(j);
            if ((first === null) && /^ *<(?!!--)/.test(lines[j])) {
                first = lines[j];
            }
        }
        assert.match(first, /^ *<div class="list-tools fm-bar[" ]/, 'the bar first in its head');
    }
    assert.strictEqual(heads, 2, 'the list\'s bar and the editor\'s');
    const notes = lines.map((v, i) => (v.includes('fm-note"') ? i : -1)).filter(v => v >= 0);
    assert.strictEqual(notes.length, 3);
    assert.deepStrictEqual(notes.filter(v => (inside.has(v) === false)), [], 'every note under a bar is in its head');
});

// The slim row says the state in its first word and Memory short; it shows once the mark under
// the head has passed the top of the page that scrolls, and folds its tabs where they do not fit
test('the slim row docks once the head is gone, and folds tabs that do not fit', async function () {
    const item_slim = (await import(path.join(PUBLIC, 'item_slim.js'))).default;
    const tabs = [{key: 'overview', label: 'Overview', count: null}, {key: 'services', label: 'Services', count: 3}];
    const more = [{key: 'docker', label: 'Docker'}, {key: 'disks', label: 'Disks'}];
    const slim = vm_of(item_slim, {icon: '', name: 'vps1', state: {tone: 'run', text: 'online · up 41d 0s'}, facts: [], tabs, more, tab: 'docker'});
    assert.strictEqual(slim.word, 'online');
    assert.strictEqual(slim.label_short('Memory'), 'Mem');
    assert.strictEqual(slim.label_short('CPU'), 'CPU');
    assert.deepStrictEqual(slim.tabs_all.map(v => v.key), ['overview', 'services', 'docker', 'disks']);
    assert.strictEqual(slim.tab_now.label, 'Docker', 'the folded button names the tab open');
    assert.strictEqual(slim.more_now.label, 'Docker', 'More ▾ names the tab open under it');
    assert.strictEqual(vm_of(item_slim, {state: {tone: 'bad', text: 'not connected'}}).word, 'not connected');

    slim.refresh_shown([{isIntersecting: true, boundingClientRect: {top: 300}, rootBounds: {top: 52}}]);
    assert.strictEqual(slim.shown, false, 'the head in sight');
    slim.refresh_shown([{isIntersecting: false, boundingClientRect: {top: 51}, rootBounds: {top: 52}}]);
    assert.strictEqual(slim.shown, true, 'the head scrolled away');
    slim.menu = 'more';
    slim.refresh_shown([{isIntersecting: false, boundingClientRect: {top: 1200}, rootBounds: {top: 52}}]);
    assert.strictEqual(slim.shown, false, 'a head below the window is not gone');
    assert.strictEqual(slim.menu, '', 'its menu goes with it');

    slim.$refs = {room: {clientWidth: 300}, need: {offsetWidth: 546}};
    slim.refresh_fold();
    assert.strictEqual(slim.fold, true, 'too narrow: one button');
    slim.$refs.room.clientWidth = 546;
    slim.refresh_fold();
    assert.strictEqual(slim.fold, false, 'room enough: the tabs');
});

// The slim row carries the head's one switch, the rate, and never History's span: scrolled away
// or not, the machine's head reads at one rate and picks no span
test('the slim row carries the head\'s rate, never History\'s span', function () {
    const page = fs.readFileSync(path.join(PUBLIC, 'serviceman.js'), 'utf8');
    const slim = /<item-slim [^>]*>\n\s*(<[^\n]*)\n\s*<\/item-slim>/.exec(page);
    assert.ok(slim !== null, 'the slim row holds one element');
    assert.match(slim[1], /^<charts-rate-switch v-if="charts_able" :view="view" :rate="charts_rate" @rate="charts_rate_pick"\/>$/);
    assert.doesNotMatch(page, /<charts-switch|<charts-range-switch/, 'the span is History\'s alone');
    const css = fs.readFileSync(path.join(PUBLIC, 'serviceman.css'), 'utf8');
    assert.doesNotMatch(css, /\.charts-switch\.compact/, 'no compact switch is left');
});
