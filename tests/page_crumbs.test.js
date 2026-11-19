const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');

async function page_crumbs_of()
{
    return (await import(path.join(PUBLIC, 'page_crumbs.js'))).default;
}

async function categories_of()
{
    return (await import(path.join(PUBLIC, 'categories.js')));
}

// A category's own page has only the first crumb: the category itself
test('a category page has no crumb after the first', async function () {
    const page_crumbs = await page_crumbs_of();
    assert.deepStrictEqual(page_crumbs({page: 'list', name: '', title: '', tab: ''}), []);
});

// An item on its first tab is where you are: its name, not a link
test('a machine on its Overview is its name alone, the last crumb', async function () {
    const page_crumbs = await page_crumbs_of();
    assert.deepStrictEqual(page_crumbs({page: 'remote', name: 'vps1', title: '', tab: 'overview'}), [{label: 'vps1', to: null}]);
});

// Remotes ▾ › vps1 › Settings: the name goes back up to its Overview, the tab is where you are
test('a tab of an item is a crumb after its name, the name a way back to its Overview', async function () {
    const page_crumbs = await page_crumbs_of();
    assert.deepStrictEqual(page_crumbs({page: 'remote', name: 'vps1', title: 'Hetzner, Falkenstein', tab: 'settings'}), [
        {label: 'Hetzner, Falkenstein', to: {page: 'remote', name: 'vps1', tab: 'overview'}},
        {label: 'Settings', to: null},
    ]);
    assert.deepStrictEqual(page_crumbs({page: 'service', name: 'grafana', title: '', tab: 'files'}), [
        {label: 'grafana', to: {page: 'service', name: 'grafana', tab: 'overview'}},
        {label: 'Files', to: null},
    ]);
    assert.deepStrictEqual(page_crumbs({page: 'remote', name: 'laptop', title: '', tab: 'shell'}).map(v => v.label), ['laptop', 'Shell']);
});

// A tab the page does not know (an address from an older serviceman) is not a crumb of its own
test('a tab no tab bar has is left out, the item its last crumb', async function () {
    const page_crumbs = await page_crumbs_of();
    assert.deepStrictEqual(page_crumbs({page: 'service', name: 'grafana', title: '', tab: 'docker'}), [{label: 'grafana', to: null}]);
});

test('a form is one crumb after its category', async function () {
    const page_crumbs = await page_crumbs_of();
    assert.deepStrictEqual(page_crumbs({page: 'new-service', name: '', title: '', tab: ''}), [{label: 'New service', to: null}]);
    assert.deepStrictEqual(page_crumbs({page: 'new-remote', name: '', title: '', tab: ''}), [{label: 'New remote', to: null}]);
    assert.deepStrictEqual(page_crumbs({page: 'new-database', name: '', title: '', tab: ''}), [{label: 'New database', to: null}]);
});

// Databases ▾ › orders: a database is its name; a server with none in it is the server's name
test('a database is one crumb, its name, or its server\'s when it has none', async function () {
    const page_crumbs = await page_crumbs_of();
    assert.deepStrictEqual(page_crumbs({page: 'database', name: 'postgresql-1', title: 'orders', tab: ''}), [{label: 'orders', to: null}]);
    assert.deepStrictEqual(page_crumbs({page: 'database', name: 'postgresql-1', title: '', tab: ''}), [{label: 'postgresql-1', to: null}]);
});

// The first crumb's menu lists the seven the designer drew, in that order; every category has
// what All categories draws, and a key the page and the server both know
test('the categories: seven in the menu, each with its name, words, icon and group', async function () {
    const {default: categories, ALL} = await categories_of();
    const menu = categories.filter(v => v.menu > 0).sort((a, b) => a.menu - b.menu).map(v => v.name);
    assert.deepStrictEqual(menu, ['Services', 'Databases', 'Remotes', 'Addresses', 'Shared folders', 'Secrets', 'Tokens']);
    assert.strictEqual(new Set(categories.map(v => v.key)).size, categories.length, 'no key twice');
    for (const item of [...categories, ALL]) {
        assert.match(item.key, /^[a-z-]+$/);
        assert.strictEqual((item.name !== '') && (item.says !== '') && (item.icon !== ''), true, `${item.key} says what it is`);
        assert.doesNotMatch(item.icon, /<script|on[a-z]+=/i, `${item.key}: an icon is shapes only`);
    }
    assert.strictEqual(categories.every(v => v.group !== ''), true);
});
