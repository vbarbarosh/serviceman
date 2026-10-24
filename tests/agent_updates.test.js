const agent_updates = require('../src/agent/src/agent_updates');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// What is waiting is apt's own count of the upgrade Install runs: right after it, nothing; and
// what apt keeps back, phased updates, is said apart and never counted as to install
test('updates are counted by apt with the upgrade Install runs, and what it keeps back is held', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-updates-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const apt = path.join(dir, 'apt-get');
    const asked = path.join(dir, 'asked');
    const answer = path.join(dir, 'answer');
    fs.writeFileSync(apt, `#!/bin/sh\necho "$@" > ${asked}\ncat ${answer}\n`, {mode: 0o755});
    fs.writeFileSync(answer, [
        'Reading package lists...',
        'The following packages have been kept back:',
        '  libnss-systemd systemd',
        'Inst openssl [3.0.13-0ubuntu3.4] (3.0.13-0ubuntu3.5 Ubuntu:24.04/noble-security [amd64])',
        'Inst linux-image-6.8.0-48-generic (6.8.0-48.48 Ubuntu:24.04/noble-updates [amd64])',
        '1 upgraded, 1 newly installed, 0 to remove and 2 not upgraded.',
    ].join('\n'));
    const before = await agent_updates({apt: `sudo -n ${apt}`});
    assert.strictEqual(fs.readFileSync(asked, 'utf8').trim(), '-s upgrade --with-new-pkgs', 'the dry run of the upgrade Install runs, without sudo');
    assert.deepStrictEqual([before.pending, before.security, before.held], [2, 1, 2]);

    // Installed: apt is asked again, whatever the time of the files it watches
    fs.writeFileSync(answer, 'Reading package lists...\n0 upgraded, 0 newly installed, 0 to remove and 2 not upgraded.\n');
    agent_updates.recount();
    const after = await agent_updates({apt: `sudo -n ${apt}`});
    assert.deepStrictEqual([after.pending, after.security, after.held], [0, 0, 2]);
});
