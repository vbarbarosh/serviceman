const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tailscale_run = require('../src/main/src/helpers/tailscale_run');
const tailscale_view = require('../src/main/src/helpers/tailscale_view');
const test = require('node:test');

// tailscale as the image has it, told by a file what to answer: its status, or that it is not
// there at all
const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-tailscale-view-'));
const status_file = path.join(fake, 'status.json');
fs.writeFileSync(path.join(fake, 'tailscale'), `#!/bin/sh
case "$1" in
    status) cat "${status_file}" ;;
    cert) echo "-----BEGIN PRIVATE KEY-----"; echo secret; echo "-----END PRIVATE KEY-----" ;;
esac
`, {mode: 0o755});

// The Tailscale page's word on this machine: on the tailnet, waiting for a sign-in, or with no
// tailscale at all; and every call kept, what it printed never
test('the Tailscale page says what tailscale says, and keeps each call but not its output', async function (t) {
    const path_before = process.env.PATH;
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-tailscale-view-state-'));
    t.after(function () {
        process.env.PATH = path_before;
        fs.rmSync(fake, {recursive: true, force: true});
        fs.rmSync(state, {recursive: true, force: true});
    });
    const app = app_from_config(config_from_json({services: []}, state));

    process.env.PATH = `${fake}${path.delimiter}${path_before}`;
    fs.writeFileSync(status_file, JSON.stringify({Version: '1.90.6', BackendState: 'Running', Self: {DNSName: 'serviceman.tail1234.ts.net.', TailscaleIPs: ['100.64.0.20']}, CurrentTailnet: {Name: 'tail1234', MagicDNSEnabled: true}, CertDomains: ['serviceman.tail1234.ts.net']}));
    const running = await tailscale_view(app);
    assert.deepStrictEqual([running.here, running.state, running.name, running.addresses, running.magic_dns, running.cert_domains, running.login_link], [true, 'Running', 'serviceman.tail1234.ts.net', ['100.64.0.20'], true, ['serviceman.tail1234.ts.net'], null]);
    assert.strictEqual(running.certificate.held, false, 'none held before it is asked');

    fs.writeFileSync(status_file, JSON.stringify({BackendState: 'NeedsLogin', AuthURL: 'https://login.tailscale.com/a/1a2b3c', Self: {DNSName: ''}, CertDomains: null}));
    const login = await tailscale_view(app);
    assert.deepStrictEqual([login.state, login.login_link, login.name, login.cert_domains], ['NeedsLogin', 'https://login.tailscale.com/a/1a2b3c', null, []]);

    await new Promise(v => tailscale_run(['cert', '--cert-file', '-', '--key-file', '-', 'serviceman.tail1234.ts.net'], {}, v));
    const calls = tailscale_run.calls();
    assert.strictEqual(calls[0].command, 'tailscale cert --cert-file - --key-file - serviceman.tail1234.ts.net', 'the newest first');
    assert.strictEqual(calls[0].error, null);
    assert.strictEqual(JSON.stringify(calls).includes('secret'), false, 'what a call printed, a key above all, is never kept');

    process.env.PATH = path.join(fake, 'none');
    const none = await tailscale_view(app);
    assert.deepStrictEqual([none.here, none.error, none.state], [false, 'no tailscale here', null]);
    assert.strictEqual(tailscale_run.calls()[0].error, 'no tailscale here');
});
