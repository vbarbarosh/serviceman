const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fs = require('fs');
const is_localhost_url = require('../src/main/src/helpers/is_localhost_url');
const k6_script = require('../src/main/src/helpers/k6_script');
const load_test_log_path = require('../src/main/src/helpers/load_test_log_path');
const load_test_log_write = require('../src/main/src/helpers/load_test_log_write');
const load_test_runs_write = require('../src/main/src/helpers/load_test_runs_write');
const load_test_said = require('../src/main/src/helpers/load_test_said');
const load_test_url = require('../src/main/src/helpers/load_test_url');
const os = require('os');
const path = require('path');
const test = require('node:test');

const REMOTES = [{name: 'laptop', token: '0123456789abcdef0123456789abcdef'}];
const SERVICES = [{name: 'hello', type: 'external', publish: {host: 'hello.localhost/app'}, upstream: '127.0.0.1:4799'}];

function config_of(load_tests)
{
    return config_from_json({listen: {port: 3000}, remotes: REMOTES, services: SERVICES, load_tests}, os.tmpdir());
}

test('a load test is read from the config, with what it left out as null', function () {
    const config = config_of([{name: 'hello', service: 'hello', remote: 'laptop', vus: 20, duration: '30s'}]);
    assert.deepStrictEqual(config.load_tests, [{name: 'hello', service: 'hello', remote: 'laptop', url: null, vus: 20, duration: '30s', duration_ms: 30000, p95_ms: null, errors_pct: null}]);
    assert.deepStrictEqual(config_of(undefined).load_tests, []);
});

test('a load test that could not run is refused, and says where', function () {
    const good = {name: 'hello', service: 'hello', remote: 'laptop', vus: 20, duration: '30s'};
    assert.throws(() => config_of([Object.assign({}, good, {name: 'Bad Name'})]), /load_tests\[0\]\.name/);
    assert.throws(() => config_of([Object.assign({}, good, {service: 'nobody'})]), /load_tests\[0\]\.service: no service named "nobody"/);
    assert.throws(() => config_of([Object.assign({}, good, {remote: 'nowhere'})]), /load_tests\[0\]\.remote: no remote named "nowhere"/);
    assert.throws(() => config_of([Object.assign({}, good, {vus: 0})]), /load_tests\[0\]\.vus/);
    assert.throws(() => config_of([Object.assign({}, good, {duration: '2h'})]), /load_tests\[0\]\.duration/);
    assert.throws(() => config_of([Object.assign({}, good, {url: 'hello.localhost'})]), /load_tests\[0\]\.url/);
    assert.throws(() => config_of([good, good]), /load_tests\[1\]\.name: "hello" is used twice/);
});

test('a test without an address asks the service where serviceman serves it', function () {
    const app = app_from_config(config_of([{name: 'hello', service: 'hello', remote: 'laptop', vus: 1, duration: '1s'}, {name: 'own', service: 'hello', remote: 'laptop', url: 'https://hello.example.com/', vus: 1, duration: '1s'}]));
    assert.strictEqual(load_test_url(app, app.config.load_tests[0]), 'http://hello.localhost:3000/app/');
    assert.strictEqual(load_test_url(app, app.config.load_tests[1]), 'https://hello.example.com/', null);
});

test('the k6 script sends a name where it is told to, and carries the pass marks it has', function () {
    const test_local = {vus: 5, duration: '10s', p95_ms: 500, errors_pct: 1};
    const script = k6_script(test_local, 'http://hello.localhost:3000/', '100.64.0.7');
    assert.match(script, /"hello\.localhost": "100\.64\.0\.7"/);
    assert.match(script, /"p\(95\)<500"/);
    assert.match(script, /"rate<=0\.01"/);
    const bare = k6_script({vus: 5, duration: '10s', p95_ms: null, errors_pct: null}, 'https://hello.example.com/', null);
    assert.match(bare, /"hosts": \{\}/);
    assert.match(bare, /"thresholds": \{\}/);
});

test('the progress line k6 prints every second moves the run', function () {
    const app = {load_test_runs: [{id: 'ab12', lines: [], lines_dropped: 0, live: null}]};
    load_test_said(app, '#k6:ab12', 'running (01m02.5s), 20/20 VUs, 1774 complete and 0 interrupted iterations');
    assert.deepStrictEqual(app.load_test_runs[0].live, {ms: 62500, vus: 20, done: 1774});
    load_test_said(app, '#k6:ab12', 'default   [  25% ] 20 VUs  1.0s/4s');
    assert.strictEqual(app.load_test_runs[0].lines.length, 2);
    load_test_said(app, '#k6:gone', 'running (00m01.0s), 1/1 VUs, 1 complete and 0 interrupted iterations');
    assert.strictEqual(app.load_test_runs.length, 1);
    // The numbers are not part of the log
    load_test_said(app, '#k6:ab12', '#k6-summary {"metrics": {}}');
    assert.strictEqual(app.load_test_runs[0].lines.length, 2);
});

test('a long log keeps its last lines, and says how many went', function () {
    const app = {load_test_runs: [{id: 'ab12', lines: [], lines_dropped: 0, live: null}]};
    for (let i = 0; i < 2005; i++) {
        load_test_said(app, '#k6:ab12', `line ${i}`);
    }
    assert.strictEqual(app.load_test_runs[0].lines.length, 2000);
    assert.strictEqual(app.load_test_runs[0].lines[0], 'line 5');
    assert.strictEqual(app.load_test_runs[0].lines_dropped, 5);
});

test('a run\'s log is kept while the run is, and goes with it', function () {
    const app = {state_dir: fs.mkdtempSync(path.join(os.tmpdir(), 'load-tests-')), load_test_runs: []};
    for (let i = 0; i < 21; i++) {
        const run = {id: `r${i}`, test: 'hello', lines: [`k6 said ${i}`], lines_dropped: 0, ended_at: i};
        app.load_test_runs.push(run);
        load_test_log_write(app, run);
    }
    load_test_runs_write(app);
    assert.strictEqual(app.load_test_runs.length, 20);
    assert.strictEqual(fs.existsSync(load_test_log_path(app, 'r0')), false);
    assert.strictEqual(fs.readFileSync(load_test_log_path(app, 'r20'), 'utf8'), 'k6 said 20\n');
    const kept = JSON.parse(fs.readFileSync(path.join(app.state_dir, 'load_test_runs.json'), 'utf8'));
    assert.deepStrictEqual(kept.runs[0].lines, []);
});

test('a .localhost address is serviceman\'s own name, and no other is', function () {
    assert.strictEqual(is_localhost_url('http://whoami.localhost:3000/'), true);
    assert.strictEqual(is_localhost_url('http://localhost:3000/'), true);
    assert.strictEqual(is_localhost_url('https://echo.example.com/'), false);
    assert.strictEqual(is_localhost_url('http://notlocalhost.com/'), false);
});
