const agent_stats = require('../src/agent/src/agent_stats');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const LINE = {cpu: 25, load: 0.5, mem_used: 3*1024**3, mem_total: 8*1024**3, mounts: [{path: '/', used: 40, size: 100}, {path: '/data', used: 10, size: 50}], temperature: {c: 48, of: 'x86_pkg_temp'}, battery: null};

// The numbers are servermon's last line: fresh, they are the machine's; older than 5 seconds,
// there are none, and the stats say servermon is silent since that line
test('the stats are servermon\'s last line, and none while it is silent', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-stats-'));
    const was = process.env.SERVICEMAN_LOG_DIR;
    process.env.SERVICEMAN_LOG_DIR = dir;
    try {
        fs.mkdirSync(path.join(dir, 'servermon'));
        const file = path.join(dir, 'servermon', '20261018.jsonl');
        const old = new Date(Date.now() - 60000).toISOString();
        fs.writeFileSync(file, `${JSON.stringify(Object.assign({time: old}, LINE, {cpu: 99}))}\n${JSON.stringify(Object.assign({time: new Date().toISOString()}, LINE))}\n`);
        const fresh = await agent_stats({dir: '/data/www'});
        assert.strictEqual(fresh.servermon.state, 'running');
        assert.strictEqual(fresh.cpu_busy, 0.25);
        assert.strictEqual(fresh.mem_free, 5*1024**3);
        assert.strictEqual(fresh.disk_free, 40, 'the free room of /data, the mount the folder is under');
        assert.deepStrictEqual(fresh.disks, {count: 2, total: 150, used: 50});
        assert.deepStrictEqual(fresh.temperature, {c: 48, of: 'x86_pkg_temp'});

        fs.writeFileSync(file, `${JSON.stringify(Object.assign({time: old}, LINE))}\n`);
        const silent = await agent_stats({dir: '/'});
        assert.deepStrictEqual(silent.servermon, {state: 'silent', last_at: old});
        assert.deepStrictEqual([silent.cpu_busy, silent.mem_free, silent.disk_free, silent.disks, silent.load], [null, null, null, null, null]);

        process.env.SERVICEMAN_LOG_DIR = 'none';
        assert.deepStrictEqual((await agent_stats({dir: '/'})).servermon, {state: 'off', last_at: null});
    }
    finally {
        process.env.SERVICEMAN_LOG_DIR = was;
        if (was === undefined) {
            delete process.env.SERVICEMAN_LOG_DIR;
        }
        fs.rmSync(dir, {recursive: true, force: true});
    }
});
