const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');

const APPS = [
    {name: 'notes', words: ['page'], address: 'notes.localhost'},
    {name: 'google-docs-writer', words: ['app folder', 'laptop'], address: 'google-docs-writer.localhost'},
    {name: 'Почта', words: ['socket'], address: 'mail.localhost'},
    {name: 'grafana', words: ['app folder'], address: 'charts.localhost'},
    {name: 'mailer', words: [], address: 'm.localhost'},
];

function names(list)
{
    return list.map(v => v.name);
}

// The search box on Apps and on the page of apps finds as navplace's does
test('apps search: words, parts, marks and order as navplace has them', async function () {
    const apps_search = (await import(path.join(PUBLIC, 'apps_search.js'))).default;
    assert.deepStrictEqual(names(apps_search(APPS, '').found), names(APPS), 'nothing typed shows every app');
    assert.deepStrictEqual(names(apps_search(APPS, '  ').tops), []);
    assert.deepStrictEqual(names(apps_search(APPS, 'DOC').found), ['google-docs-writer'], 'lower case');
    assert.deepStrictEqual(names(apps_search(APPS, 'pochta').found), ['Почта'], 'Cyrillic found by Latin');
    assert.deepStrictEqual(names(apps_search(APPS, 'socket').found), ['Почта'], 'by a word of the app');
    assert.deepStrictEqual(names(apps_search(APPS, 'chart').found), ['grafana'], 'by its address');
    assert.deepStrictEqual(names(apps_search(APPS, 'mail').found), ['mailer', 'Почта'], 'names before addresses');
    assert.deepStrictEqual(names(apps_search(APPS, 'app/laptop').found), ['google-docs-writer'], '/ is and');
    assert.deepStrictEqual(names(apps_search(APPS, '^g').found), ['google-docs-writer', 'grafana'], '^ at the start');
    assert.deepStrictEqual(names(apps_search(APPS, 'na$').found), ['grafana'], '$ at the end');
    assert.deepStrictEqual(names(apps_search(APPS, 'app/!laptop').found), ['grafana'], '! for none');
    const two = apps_search(APPS, 'notes graf');
    assert.deepStrictEqual(names(two.found), ['grafana'], 'the last word shows');
    assert.deepStrictEqual(names(two.tops), ['notes', 'grafana'], 'the first of each word opens');
    assert.deepStrictEqual(names(apps_search(APPS, 'zzz').found), []);
});
