const assert = require('assert');
const fs = require('fs');
const lines_serve = require('./lines_serve');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('without an admin token the endpoint runs, and says why it issues nothing', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lines-'));
    const server = lines_serve({admin_token: null, admin_off: 'ADMIN_TOKEN is not set', admin_ips: [], clickhouse: 'http://127.0.0.1:9', table: 'default.otel_logs', tokens_file: path.join(dir, 'tokens.json'), uid: 'ctest0000000'});
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(function () {
        server.closeAllConnections();
        server.close();
    });
    const answer = await fetch(`http://127.0.0.1:${server.address().port}/tokens`, {method: 'POST', headers: {authorization: 'Bearer anything'}, body: JSON.stringify({name: 'vps1', ips: ['127.0.0.1']})});
    assert.strictEqual(answer.status, 503);
    assert.deepStrictEqual(await answer.json(), {error: 'no token is issued here: ADMIN_TOKEN is not set'});
    assert.strictEqual(fs.existsSync(path.join(dir, 'tokens.json')), false);
});
