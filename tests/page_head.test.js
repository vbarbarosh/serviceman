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
