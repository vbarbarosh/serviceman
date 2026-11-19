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
