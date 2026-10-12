const assert = require('assert');
const build_pages = require('../src/pages/build_pages');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const DOCS_DIR = path.resolve(__dirname, '..', 'docs');

// The site is committed beside the .md it is built from: a doc changed without
// bin/build-pages shows here, before GitHub Pages serves the old one
test('the pages in docs/ are built from the docs as they are now', function () {
    for (const page of build_pages()) {
        const file = path.join(DOCS_DIR, page.path);
        assert.ok(fs.existsSync(file), `docs/${page.path} is missing: run bin/build-pages`);
        assert.strictEqual(fs.readFileSync(file, 'utf8'), page.text, `docs/${page.path} is out of date: run bin/build-pages`);
    }
});

// Every link between the pages lands on a page of the site, and on a heading of it
test('every link of the site lands on a page and a heading', function () {
    const pages = build_pages().filter(v => v.path.endsWith('.html'));
    const ids = new Map(pages.map(v => [v.path, new Set([...v.text.matchAll(/ id="([^"]+)"/g)].map(vv => vv[1]))]));
    for (const page of pages) {
        assert.doesNotMatch(page.text, /\{\{\w+\}\}/, `docs/${page.path}: a {{value}} left unfilled`);
        for (const [, href] of page.text.matchAll(/ (?:href|src)="([^"]+)"/g)) {
            if (/^([a-z]+:|\/\/)/i.test(href)) {
                continue;
            }
            const [file, hash] = href.split('#');
            const target = file ? path.posix.normalize(path.posix.join(path.posix.dirname(page.path), file)) : page.path;
            if (!target.endsWith('.html')) {
                assert.ok(fs.existsSync(path.join(DOCS_DIR, target)), `docs/${page.path}: ${href} is not there`);
                continue;
            }
            assert.ok(ids.has(target), `docs/${page.path}: ${href} is not a page of the site`);
            if (hash) {
                assert.ok(ids.get(target).has(hash), `docs/${page.path}: ${href} names no heading of ${target}`);
            }
        }
    }
});
