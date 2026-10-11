const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const counters_apply = require('../src/main/src/helpers/counters_apply');
const counters_path = require('../src/main/src/helpers/counters_path');
const counters_read = require('../src/main/src/helpers/counters_read');
const counters_write = require('../src/main/src/helpers/counters_write');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const REMOTES = [{name: 'vps1', token: 'a-token-long-enough-to-be-a-secret'}];

test('what a service counted is on disk, and the next serviceman starts from it', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-counters-'));
    const first = app_new(dir);
    const pool = first.service_by_name.pool;
    pool.state.requests = 42;
    pool.state.cold_start_ms = 1234;
    pool.state.instances[0].requests = 30;
    pool.state.instances[0].phase = 'running';
    pool.state.instances[0].started_at = 1700000000000;
    pool.state.instances[1].requests = 12;
    assert.strictEqual(counters_write(first), true);
    assert.strictEqual(counters_write(first), false, 'nothing moved, so nothing is written');

    const next = app_new(dir);
    const saved = counters_read(next);
    for (const service of next.services) {
        counters_apply(service, saved[service.name]);
    }
    const again = next.service_by_name.pool;
    assert.strictEqual(again.state.requests, 42);
    assert.strictEqual(again.state.cold_start_ms, 1234);
    assert.strictEqual(again.state.instances[0].requests, 30);
    assert.strictEqual(again.state.instances[1].requests, 12);
    // Kept aside for the probe: the copy is not known to be up until it is found running
    assert.strictEqual(again.state.instances[0].started_before, 1700000000000);
    assert.strictEqual(again.state.instances[0].started_at, null);
    assert.strictEqual(again.state.instances[1].started_before, null, 'a copy that was down came up at no time');
    assert.strictEqual(next.service_by_name.fresh.state.requests, 0, 'a service the file does not name starts from zero');
});

test('a counters file that does not read is a start from zero, not a failed start', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-counters-'));
    const app = app_new(dir);
    fs.mkdirSync(path.dirname(counters_path(app)), {recursive: true});
    fs.writeFileSync(counters_path(app), '{ not json');
    assert.deepStrictEqual(counters_read(app), {});
});

function app_new(dir)
{
    const config = config_from_json({
        remotes: REMOTES,
        services: [
            {name: 'pool', type: 'docker', remote: 'vps1', publish: {host: 'pool.test', port: 80}, image: 'nginx', policy: {instances: {max: 2}}},
            {name: 'fresh', type: 'docker', remote: 'vps1', publish: {host: 'fresh.test', port: 80}, image: 'nginx'},
        ],
    }, dir);
    const out = app_from_config(config);
    out.state_dir = dir;
    return out;
}
