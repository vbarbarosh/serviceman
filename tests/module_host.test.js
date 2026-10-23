const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const http = require('http');
const modules_served = require('../src/module-host/src/modules_served');
const os = require('os');
const page_key = require('../src/module-host/src/page_key');
const path = require('path');
const request_answer = require('../src/module-host/src/request_answer');
const test = require('node:test');

// The imports of an ES module's text: relative ones, and the bare ones the importmap names
const RE_IMPORT = /^import\s.*?from\s+'([^']+)';$/gm;
const RE_IMPORTMAP = /<script type="importmap">([\s\S]*?)<\/script>/;

// The agent keeps its folder, and the page its key, out of the checkout and out of the home of
// whoever runs the tests: page_key reads it when first asked
process.env.SERVICEMAN_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'module-host-test-'));
process.on('exit', function () {
    fs.rmSync(process.env.SERVICEMAN_AGENT_DIR, {recursive: true, force: true});
});

// module-host serves each module's page half with the control page's files beside it, as
// serviceman does; a file the page imports and module-host does not serve leaves the module
// unloaded, with nothing but an error on the page (the items view, 10-23)
test('module-host serves every file a module\'s page half imports', async function () {
    await with_server(async function (base, cookie) {
        const html = await (await fetch(`${base}/`)).text();
        const imports = JSON.parse(RE_IMPORTMAP.exec(html)[1]).imports;
        const pages = await (await fetch(`${base}/api/modules`, {headers: {cookie}})).json();
        assert.deepStrictEqual(pages.map(v => v.key), modules_served.map(v => v.key));
        const seen = new Set();
        const queue = ['/_/app/module_host.js'].concat(pages.map(v => v.page));
        while (queue.length > 0) {
            const pathname = queue.shift();
            if (seen.has(pathname)) {
                continue;
            }
            seen.add(pathname);
            const answer = await fetch(`${base}${pathname}`);
            assert.strictEqual(answer.status, 200, `${pathname} is not served`);
            for (const found of (await answer.text()).matchAll(RE_IMPORT)) {
                const resolved = import_resolve(imports, found[1]);
                if (resolved !== null) {
                    queue.push(new URL(resolved, `${base}${pathname}`).pathname);
                }
            }
        }
        for (const asked of ['/items_view.js', '/remote_shell.js', '/_/terminal/terminal.js', '/_/file_manager/file_manager.js']) {
            assert.ok(seen.has(asked), asked);
        }
        for (const url of Object.values(imports).filter(v => v.endsWith('/') === false)) {
            assert.strictEqual((await fetch(`${base}${url}`)).status, 200, `${url} is not served`);
        }
    });
});

test('module-host answers each module\'s manifest, mounted where its API is', async function () {
    await with_server(async function (base, cookie) {
        const outcome = await (await fetch(`${base}/api/v1/modules`, {headers: {cookie}})).json();
        assert.deepStrictEqual(outcome.modules.map(v => [v.module, v.base]), modules_served.map(v => [v.key, `/api/${v.key}`]));
        const rules = outcome.modules.find(v => (v.module === 'firewall')).kinds.find(v => (v.kind === 'rules'));
        assert.ok(Array.isArray(rules.columns));
    });
});

// A shell, the files and docker run behind it as the user who started it: another user of this
// computer, another site open in the same browser, and a name some site points at 127.0.0.1
// get nothing
test('module-host answers its own page only, in the browser that holds its key', async function () {
    await with_server(async function (base, cookie) {
        assert.strictEqual((await http_status(base, '/api/processes', {})).status, 403);
        assert.strictEqual((await http_status(base, '/api/processes', {cookie: 'module_host_key=nope'})).status, 403);
        assert.strictEqual((await http_status(base, '/api/terminal', {cookie, host: 'evil.example.com'})).status, 403);
        assert.strictEqual((await http_status(base, '/api/terminal', {cookie}, 'POST')).status, 403);
        assert.strictEqual((await http_status(base, '/api/terminal', {cookie, origin: 'http://evil.example.com'}, 'POST')).status, 403);
        assert.strictEqual((await http_status(base, '/?key=nope', {})).status, 403);
        const opened = await http_status(base, `/?key=${page_key()}`, {});
        assert.strictEqual(opened.status, 303);
        assert.ok(opened.headers['set-cookie'][0].startsWith(`${cookie};`));
        assert.ok(opened.headers['set-cookie'][0].includes('HttpOnly'));
        // The page itself loads without the key, and says where to open it
        assert.strictEqual((await http_status(base, '/', {})).status, 200);
    });
});

// The work is the agent's own code, run in module-host's process over a link of its own: what
// serviceman asks a machine, asked of this one
test('module-host reads this computer through the agent it runs', {timeout: 60000}, async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-host-run-'));
    const port = 40000 + Math.floor(Math.random()*10000);
    const child = child_process.spawn(process.execPath, [path.join(__dirname, '../src/module-host/index.js')], {
        env: Object.assign({}, process.env, {PORT: String(port), SERVICEMAN_AGENT_DIR: dir}),
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
        await new Promise(function (resolve, reject) {
            let said = '';
            child.stdout.on('data', function (chunk) {
                said += chunk;
                if (said.includes('?key=')) {
                    resolve();
                }
            });
            child.once('exit', v => reject(new Error(`module-host ended: ${v}`)));
        });
        const cookie = `module_host_key=${fs.readFileSync(path.join(dir, 'page.key'), 'utf8').trim()}`;
        const base = `http://localhost:${port}`;
        const processes = await (await fetch(`${base}/api/processes`, {headers: {cookie}})).json();
        assert.ok(processes.items.some(v => v.pid === child.pid), 'module-host is among the processes it lists');
        const disks = await (await fetch(`${base}/api/disks`, {headers: {cookie}})).json();
        assert.ok(disks.items.length > 0);
        const terminals = await (await fetch(`${base}/api/terminal`, {headers: {cookie}})).json();
        assert.deepStrictEqual(terminals.items, []);
        // The agent keeps what it keeps in its folder, and nothing in this checkout
        assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['page.key']);
    }
    finally {
        child.kill();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// Where a page's import is served: a path as it is, a bare name by the importmap, null for a
// name the importmap leaves to the browser (none here)
function import_resolve(imports, asked)
{
    if (asked.startsWith('.') || asked.startsWith('/')) {
        return asked;
    }
    if (imports[asked] !== undefined) {
        return imports[asked];
    }
    const prefix = Object.keys(imports).find(v => v.endsWith('/') && asked.startsWith(v));
    assert.ok(prefix !== undefined, `the importmap names no ${asked}`);
    return imports[prefix] + asked.slice(prefix.length);
}

async function with_server(fn)
{
    const server = http.createServer(request_answer);
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    try {
        await fn(`http://localhost:${server.address().port}`, `module_host_key=${page_key()}`);
    }
    finally {
        server.close();
    }
}

// fetch sets its own Host and Origin; a request that names another is made by hand
function http_status(base, pathname, headers, method)
{
    const url = new URL(base);
    return new Promise(function (resolve, reject) {
        const req = http.request({host: '127.0.0.1', port: url.port, path: pathname, method: method || 'GET', headers: Object.assign({host: url.host}, headers)}, function (res) {
            res.resume();
            resolve({status: res.statusCode, headers: res.headers});
        });
        req.on('error', reject);
        req.end();
    });
}
