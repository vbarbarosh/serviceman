const assert = require('assert');
const http = require('http');
const modules_served = require('../src/module-host/src/modules_served');
const request_answer = require('../src/module-host/src/request_answer');
const test = require('node:test');

// The imports of an ES module's text, relative ones only: the bare ones (vue) are the
// importmap's
const RE_IMPORT = /^import\s.*?from\s+'(\.{1,2}\/[^']+)';$/gm;

// module-host serves each module's page half with the control page's files beside it, as
// serviceman does; a file the page imports and module-host does not serve leaves the module
// unloaded, with nothing but an error on the page (the items view, 10-23)
test('module-host serves every file a module\'s page half imports', async function () {
    const server = http.createServer(request_answer);
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    const base = `http://localhost:${server.address().port}`;
    try {
        const seen = new Set();
        const queue = ['/_/app/module_host.js'].concat(modules_served.map(v => `/_/${v.key}/${v.key}.js`));
        while (queue.length > 0) {
            const pathname = queue.shift();
            if (seen.has(pathname)) {
                continue;
            }
            seen.add(pathname);
            const answer = await fetch(`${base}${pathname}`);
            assert.strictEqual(answer.status, 200, `${pathname} is not served`);
            for (const found of (await answer.text()).matchAll(RE_IMPORT)) {
                queue.push(new URL(found[1], `${base}${pathname}`).pathname);
            }
        }
        assert.ok(seen.has('/items_view.js'));
    }
    finally {
        server.close();
    }
});

test('module-host answers each module\'s manifest, mounted where its API is', async function () {
    const server = http.createServer(request_answer);
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    try {
        const answer = await fetch(`http://localhost:${server.address().port}/api/v1/modules`);
        const outcome = await answer.json();
        assert.deepStrictEqual(outcome.modules.map(v => [v.module, v.base]), modules_served.map(v => [v.key, `/api/${v.key}`]));
        const rules = outcome.modules[0].kinds.find(v => (v.kind === 'rules'));
        assert.ok(Array.isArray(rules.columns));
    }
    finally {
        server.close();
    }
});
