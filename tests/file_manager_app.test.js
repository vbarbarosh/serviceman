const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const test = require('node:test');

const REPO = path.resolve(__dirname, '..');

// The imports of an ES module's text, and the importmap of a page
const RE_IMPORT = /^import\s.*?from\s+'([^']+)';$/gm;
const RE_IMPORTMAP = /<script type="importmap">([\s\S]*?)<\/script>/;

// The File Manager as the app folder bin/file-manager-zip makes, run the way serviceman runs
// one: unpacked, its bin/run started with PORT in its env, and the env of the agent that starts
// it (its folder, its log, its token) passed on. Everything is asked over HTTP, as the page asks.
test('the File Manager app, unpacked from its zip, works on a folder of this computer and never outside it', {timeout: 120000}, async function (t) {
    for (const tool of ['zip', 'unzip']) {
        if (child_process.spawnSync('sh', ['-c', `command -v ${tool}`]).status !== 0) {
            t.skip(`${tool} is not installed here`);
            return;
        }
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-manager-app-'));
    t.after(function () {
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const made = child_process.spawnSync(path.join(REPO, 'bin/file-manager-zip'), [path.join(dir, 'file-manager.zip')], {encoding: 'utf8'});
    assert.strictEqual(made.status, 0, made.stdout + made.stderr);
    const unzipped = child_process.spawnSync('unzip', ['-q', path.join(dir, 'file-manager.zip'), '-d', path.join(dir, 'unpacked')], {encoding: 'utf8'});
    assert.strictEqual(unzipped.status, 0, unzipped.stderr);
    const app_dir = path.join(dir, 'unpacked/file-manager');
    assert.deepStrictEqual(fs.readdirSync(app_dir).sort(), ['LICENSE', 'bin', 'modules', 'node_modules', 'src'], 'one folder, no data/ of its own');
    assert.ok((fs.statSync(path.join(app_dir, 'bin/run')).mode & 0o111) !== 0, 'bin/run runs');

    const files = path.join(dir, 'files');
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(files);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'not for the app\n');
    fs.symlinkSync(outside, path.join(files, 'escape'));
    const app = await app_start(t, app_dir, {
        FILES_DIR: files,
        SERVICEMAN_AGENT_DIR: path.join(dir, 'agent-dir'),
        SERVICEMAN_LOG_DIR: path.join(dir, 'agent-logs'),
        SERVICEMAN_TOKEN: 'the-agent-token',
        TMPDIR: path.join(dir, 'tmp'),
    });
    const api = `${app.base}/api/files`;

    // The page, and every file it imports, its own and the module's, by the importmap
    const html = await (await fetch(`${app.base}/`)).text();
    assert.ok(html.includes('<title>Files</title>'));
    const imports = JSON.parse(RE_IMPORTMAP.exec(html)[1]).imports;
    const seen = await imports_walk(app.base, imports, '/_/app/files_app.js');
    for (const asked of ['/_/file_manager/file_manager.js', '/_/file_manager/upload_queue.js', '/data_table.js', '/fold_table.js', '/_/vendor/vue.esm-browser.prod.js']) {
        assert.ok(seen.has(asked), `${asked} is imported and served`);
    }
    for (const asked of ['/_/serviceman.css', '/_/file_manager/file_manager.css', '/_/app/files_app.css', '/_/vendor/codemirror.mjs']) {
        assert.strictEqual((await fetch(`${app.base}${asked}`)).status, 200, asked);
    }
    assert.deepStrictEqual(await (await fetch(`${app.base}/api/root`)).json(), {path: files, machine: os.hostname()});

    // The folder is /, and what is done is done to it
    const [listed_status, listed] = await json_of(fetch(`${api}?path=`));
    assert.deepStrictEqual([listed_status, listed.path, listed.items.map(v => [v.name, v.kind])], [200, '/', [['escape', 'dir']]]);
    assert.deepStrictEqual(await json_of(fetch(`${api}/upload?dir=/&name=a.txt`, {method: 'POST', body: 'hello world'})), [200, {path: '/a.txt', bytes: 11, replaced: false}]);
    assert.strictEqual(fs.readFileSync(path.join(files, 'a.txt'), 'utf8'), 'hello world');
    assert.deepStrictEqual(await json_of(post(api, 'rename', {from: '/a.txt', to: '/b.txt'})), [200, {}]);
    assert.deepStrictEqual(fs.readdirSync(files).sort(), ['b.txt', 'escape']);
    assert.deepStrictEqual(await json_of(post(api, 'mkdir', {path: '/docs/deep'})), [200, {created: true}]);
    assert.ok(fs.statSync(path.join(files, 'docs/deep')).isDirectory());
    assert.deepStrictEqual((await json_of(fetch(`${api}?path=/docs/`)))[1].path, '/docs');
    const range = await fetch(`${api}/file/b.txt`, {headers: {range: 'bytes=6-10'}});
    assert.deepStrictEqual([range.status, range.headers.get('content-range'), await range.text()], [206, 'bytes 6-10/11', 'world']);
    assert.strictEqual(range.headers.get('content-security-policy'), 'sandbox', 'a page of the folder runs as nobody');
    assert.deepStrictEqual(await json_of(post(api, 'delete', {path: '/docs'})), [200, {}]);
    assert.deepStrictEqual(fs.readdirSync(files).sort(), ['b.txt', 'escape']);

    // A path that climbs out of the folder, and a link that leads out of it, are refused, and
    // nothing is read or written outside
    const refused = [
        await json_of(fetch(`${api}?path=/../`)),
        await json_of(fetch(`${api}/file/..%2Foutside%2Fsecret.txt`)),
        await json_of(post(api, 'rename', {from: '/b.txt', to: '../b.txt'})),
        await json_of(post(api, 'mkdir', {path: '/docs/../../made'})),
        await json_of(fetch(`${api}?path=/escape`)),
        await json_of(fetch(`${api}/file/escape/secret.txt`)),
        await json_of(fetch(`${api}/upload?dir=/escape&name=c.txt`, {method: 'POST', body: 'x'})),
        await json_of(post(api, 'delete', {path: '/escape/secret.txt'})),
    ];
    for (const [status, outcome] of refused) {
        assert.strictEqual(status, 502);
        assert.match(outcome.error, /EACCES: ".*" is outside the root folder$/);
        assert.ok(outcome.error.includes(dir) === false, `the machine's path is not said: ${outcome.error}`);
    }
    assert.deepStrictEqual(fs.readdirSync(outside), ['secret.txt']);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['file-manager.zip', 'files', 'outside', 'tmp', 'unpacked']);
    assert.deepStrictEqual(fs.readdirSync(files).sort(), ['b.txt', 'escape']);
    // The root itself stays, and a missing folder is said from the root
    assert.deepStrictEqual(await json_of(post(api, 'delete', {path: '/'})), [502, {error: 'the root folder itself is not deleted: what is in it is'}]);
    assert.deepStrictEqual(await json_of(fetch(`${api}?path=/nope`)), [502, {error: 'ENOENT: no such file or directory, scandir \'/nope\''}]);
    // Another site open in the same browser cannot post to it
    assert.strictEqual((await post(api, 'mkdir', {path: '/x'}, 'http://evil.example.com')).status, 403);
    assert.strictEqual((await post(api, 'mkdir', {path: '/x'}, 'null')).status, 403);
    assert.strictEqual((await post(api, 'mkdir', {path: '/x'}, app.base)).status, 200);

    // Stopped as serviceman stops it: at once, its link's socket file gone with it
    const code = await app.stop();
    assert.strictEqual(code, 0);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
    assert.ok(app.said().includes('[files_app_end_ok] signal=SIGTERM'));
    // The agent in the app kept to the app: nothing in the folder or the log of the agent that
    // started it, and its token is not in the app's env
    assert.strictEqual(fs.existsSync(path.join(dir, 'agent-dir')), false);
    assert.strictEqual(fs.existsSync(path.join(dir, 'agent-logs')), false);
    assert.strictEqual(app.env.includes('SERVICEMAN_TOKEN='), false);
});

// bin/run started in the app folder on a free port, once it says it listens
async function app_start(t, app_dir, env)
{
    fs.mkdirSync(env.TMPDIR, {recursive: true});
    const port = await port_free();
    const child = child_process.spawn(path.join(app_dir, 'bin/run'), [], {
        cwd: os.tmpdir(),
        env: Object.assign({}, process.env, env, {PORT: String(port)}),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let said = '';
    child.stdout.on('data', function (chunk) {
        said += chunk;
    });
    child.stderr.on('data', function (chunk) {
        said += chunk;
    });
    const exited = new Promise(v => child.once('exit', v));
    t.after(function () {
        child.kill('SIGKILL');
    });
    await new Promise(function (resolve, reject) {
        const timer = setInterval(function () {
            if (said.includes('[files_app_begin]')) {
                clearInterval(timer);
                resolve();
            }
        }, 20);
        exited.then(function (code) {
            clearInterval(timer);
            reject(new Error(`bin/run ended with ${code}: ${said}`));
        });
    });
    return {
        base: `http://127.0.0.1:${port}`,
        said: () => said,
        // What the app's node runs with, as bin/run hands it over
        env: fs.readFileSync(`/proc/${child.pid}/environ`, 'utf8').split('\0').join('\n'),
        stop: function () {
            child.kill('SIGTERM');
            return exited;
        },
    };
}

// Every module a page loads from one, by its imports: each one must be served
async function imports_walk(base, imports, first)
{
    const out = new Set();
    const queue = [first];
    while (queue.length > 0) {
        const pathname = queue.shift();
        if (out.has(pathname)) {
            continue;
        }
        out.add(pathname);
        const answer = await fetch(`${base}${pathname}`);
        assert.strictEqual(answer.status, 200, `${pathname} is not served`);
        // A path is the module's own; a bare name is the importmap's, which is the page's
        for (const found of (await answer.text()).matchAll(RE_IMPORT)) {
            const asked = found[1];
            if (asked.startsWith('.') || asked.startsWith('/')) {
                queue.push(new URL(asked, `${base}${pathname}`).pathname);
                continue;
            }
            assert.ok(imports[asked] !== undefined, `the importmap names no ${asked}`);
            queue.push(new URL(imports[asked], `${base}/`).pathname);
        }
    }
    return out;
}

// One change asked of the API, as the page asks it; origin, when given, is the page's
function post(api, action, body, origin)
{
    const headers = (origin === undefined) ? {} : {origin};
    return fetch(`${api}/${action}`, {method: 'POST', headers, body: JSON.stringify(body)});
}

async function json_of(promise)
{
    const answer = await promise;
    return [answer.status, await answer.json()];
}

function port_free()
{
    return new Promise(function (resolve, reject) {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', function () {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}
