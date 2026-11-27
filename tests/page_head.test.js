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
// tab that fills the height (a terminal, a file manager, a service's lines) keeps the page still.
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
