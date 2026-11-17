const app_from_config = require('../src/main/src/helpers/app_from_config');
const app_ports_here = require('../src/main/src/helpers/app_ports_here');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const problems_check = require('../src/main/src/helpers/problems_check');
const problems_of_tailnet_cert = require('../src/main/src/helpers/problems_of_tailnet_cert');
const server_start = require('../src/main/src/helpers/server_start');
const tailnet_cert_read = require('../src/main/src/helpers/tailnet_cert_read');
const test = require('node:test');
const tls = require('tls');
const ws = require('ws');

// A certificate for the placeholder tailnet name, as `tailscale cert` prints it: the
// certificate, then its key
const PAIR = fs.readFileSync(path.join(__dirname, 'fixtures', 'tailnet_cert.pem'), 'utf8');
const NAME = 'serviceman.tail1234.ts.net';
const CA = tailnet_cert_read.pair_of(PAIR).cert;

// tailscale as the image has it, told by the environment what to say: serviceman's tailnet
// name, and the certificate or the reason there is none
const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-tailscale-'));
fs.writeFileSync(path.join(fake, 'tailscale'), `#!/bin/sh
case "$1" in
    status) echo '{"Self": {"DNSName": "${NAME}."}}' ;;
    cert) if [ -n "$FAKE_CERT_REFUSED" ]; then echo "$FAKE_CERT_REFUSED" >&2; exit 1; fi; cat "$FAKE_CERT_FILE" ;;
esac
`, {mode: 0o755});
process.env.PATH = `${fake}:${process.env.PATH}`;
process.env.FAKE_CERT_FILE = path.join(__dirname, 'fixtures', 'tailnet_cert.pem');

// Asked until tailscale gives one, said once per reason; one held stays when a renewal fails
test('the tailnet\'s certificate: asked of tailscale, kept in memory, its failures said once', async function (t) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-tailnet-cert-'));
    t.after(function () {
        delete process.env.FAKE_CERT_REFUSED;
        fs.rmSync(state, {recursive: true, force: true});
        fs.rmSync(fake, {recursive: true, force: true});
    });
    const app = app_from_config(config_from_json({services: []}, state));
    function lines(name) {
        return app.log_lines.filter(v => v.includes(`[${name}]`));
    }

    process.env.FAKE_CERT_REFUSED = '500 Internal Server Error: your Tailscale account does not support getting TLS certs';
    await tailnet_cert_read(app);
    assert.strictEqual(app.tailnet_cert.context, null);
    assert.strictEqual(app.tailnet_cert.error, process.env.FAKE_CERT_REFUSED);
    assert.strictEqual(lines('tailnet_cert_error').length, 1);
    assert.match(lines('tailnet_cert_error')[0], /answer http; asked again in 10 minutes/);
    // Health says it, and what mends it
    const problems = problems_of_tailnet_cert(app);
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0].cause, /does not support getting TLS certs/);
    assert.match(problems[0].fix, /DNS page, HTTPS Certificates, Enable HTTPS/);
    // ...in words that say why, with the page that mends it, for the bar on every page
    assert.strictEqual(problems[0].subject, 'No https for the apps: HTTPS is off for your tailnet');
    assert.deepStrictEqual(problems[0].link, {text: 'Turn HTTPS on in Tailscale', href: 'https://login.tailscale.com/admin/dns'});
    const asked = app.tailnet_cert.at;
    await tailnet_cert_read(app);
    assert.strictEqual(app.tailnet_cert.at, asked, 'not asked again within ten minutes');
    app.tailnet_cert.at = 1;
    await tailnet_cert_read(app);
    assert.strictEqual(lines('tailnet_cert_error').length, 1, 'the same reason is said once');

    delete process.env.FAKE_CERT_REFUSED;
    app.tailnet_cert.at = 1;
    await tailnet_cert_read(app);
    assert.notStrictEqual(app.tailnet_cert.context, null);
    assert.strictEqual(app.tailnet_cert.domain, NAME);
    assert.match(app.tailnet_cert.until, /^2126-/);
    assert.strictEqual(app.tailnet_cert.error, null);
    assert.strictEqual(lines('tailnet_cert').length, 1);
    assert.deepStrictEqual(problems_of_tailnet_cert(app), []);

    // A renewal that fails keeps the one held: it is good until it ends
    process.env.FAKE_CERT_REFUSED = 'tailscale is down';
    const context = app.tailnet_cert.context;
    app.tailnet_cert.at = 1;
    await tailnet_cert_read(app);
    assert.strictEqual(app.tailnet_cert.context, context);
    assert.match(lines('tailnet_cert_error')[1], /the one held is used until 2126-.*asked again tomorrow/);
    assert.deepStrictEqual(problems_of_tailnet_cert(app), [], 'one held is no problem yet');
    const other = problems_of_tailnet_cert({config: {apps: {ports: 3400}}, tailnet_cert: {context: null, error: 'tailscale is down'}});
    assert.doesNotMatch(other[0].fix, /Enable HTTPS/);
    assert.strictEqual(other[0].subject, 'No https for the apps: tailscale gives no certificate');
    assert.strictEqual(other[0].link, null);
    assert.throws(() => tailnet_cert_read.pair_of('no pem here'), /tailscale cert printed no certificate and key/);
});

// An app's own port answers https on the tailnet's certificate, a websocket too, and plain http
// beside it: a program's request is answered, a browser's page visit by the tailnet name goes on
// to https. With no certificate it is the http port it always was.
test('an app\'s own port answers https and http, and sends a browser on to https', async function (t) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-https-'));
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    // The app: a page that says how it was reached, and a websocket that echoes
    const seen = [];
    const upstream = http.createServer(function (req, res) {
        seen.push(req.headers['x-forwarded-proto']);
        res.end(`the page ${req.method} ${req.url}`);
    });
    const sockets = new ws.WebSocketServer({server: upstream});
    sockets.on('connection', function (client) {
        client.on('message', function (data) {
            client.send(`echo ${data}`);
        });
    });
    const socket_path = path.join(state, 'agency.sock');
    await new Promise(v => upstream.listen(socket_path, v));
    const app = app_from_config(config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        services: [{name: 'agency', type: 'external', publish: {host: 'agency.localhost'}, socket: socket_path}],
    }, state));
    const servers = await server_start(app);
    t.after(async function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        app.config = Object.assign({}, app.config, {apps: Object.assign({}, app.config.apps, {ports: null})});
        await app_ports_here(app);
        sockets.close();
        upstream.close();
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });
    await app_ports_here(app);
    const port = app.app_ports_here.agency.port;
    const browser = {'upgrade-insecure-requests': '1'};

    // No certificate yet: http as before, and a TLS handshake is refused
    assert.strictEqual((await fetch_host({port, host: NAME, path: '/', headers: browser})).body, 'the page GET /');
    await assert.rejects(https_get(port, NAME, '/'), /socket disconnected|ECONNRESET/);

    // The page hears why at once, for each app's tailnet link, not after Health's two checks
    app.tailnet_cert.error = '500 Internal Server Error: your Tailscale account does not support getting TLS certs';
    const off = (await status_of(servers)).tailnet.https_off;
    assert.strictEqual(off.why, 'HTTPS is off for your tailnet');
    assert.strictEqual(off.said, '500 Internal Server Error: your Tailscale account does not support getting TLS certs');
    assert.deepStrictEqual(off.link, {text: 'Turn HTTPS on in Tailscale', href: 'https://login.tailscale.com/admin/dns'});

    app.tailnet_cert.domain = NAME;
    app.tailnet_cert.context = tls.createSecureContext(tailnet_cert_read.pair_of(PAIR));
    assert.strictEqual((await status_of(servers)).tailnet.https_off, null, 'nothing to say once it is https');

    // https, the certificate the tailnet's name expects, and the app told it was https
    seen.length = 0;
    const page = await https_get(port, NAME, '/x?y=1');
    assert.strictEqual(page.status, 200);
    assert.strictEqual(page.body, 'the page GET /x?y=1');
    assert.deepStrictEqual(seen, ['https']);
    assert.strictEqual(await echo(`wss://127.0.0.1:${port}/ws`), 'echo hi', 'a websocket over https');

    // http beside it: a program is answered where it asked, a websocket too
    assert.strictEqual((await fetch_host({port, host: NAME, path: '/api'})).body, 'the page GET /api');
    assert.strictEqual((await fetch_host({port, host: NAME, method: 'POST', path: '/api', headers: browser})).body, 'the page POST /api');
    assert.strictEqual(await echo(`ws://127.0.0.1:${port}/ws`), 'echo hi', 'a websocket over http');
    // A browser's page visit by the tailnet's name, its first word or its address goes on to https
    for (const host of [NAME, 'serviceman', '100.64.0.20']) {
        const sent = await fetch_host({port, host, path: '/ui/index.html?a=1', headers: browser});
        assert.strictEqual(sent.status, 307, host);
        assert.strictEqual(sent.headers.location, `https://${NAME}:${port}/ui/index.html?a=1`, host);
    }
    // A name of this computer is not the certificate's: answered where it was asked
    for (const host of ['127.0.0.1', 'localhost', 'agency.localhost']) {
        assert.strictEqual((await fetch_host({port, host, path: '/', headers: browser})).status, 200, host);
    }

    // Gone again: https is refused, http answers everybody where they asked
    app.tailnet_cert.context = null;
    await assert.rejects(https_get(port, NAME, '/'), /socket disconnected|ECONNRESET/);
    assert.strictEqual((await fetch_host({port, host: NAME, path: '/', headers: browser})).status, 200);

    function https_get(at, host, url) {
        return new Promise(function (resolve, reject) {
            const request = https.get({host: '127.0.0.1', port: at, servername: host, ca: CA, agent: false, path: url, headers: {host}}, function (answer) {
                const chunks = [];
                answer.on('data', v => chunks.push(v));
                answer.on('end', () => resolve({status: answer.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
            });
            request.on('error', reject);
        });
    }
    function echo(url) {
        return new Promise(function (resolve, reject) {
            const client = new ws(url, {ca: CA, servername: NAME, headers: {host: NAME}});
            client.on('error', reject);
            client.on('open', () => client.send('hi'));
            client.on('message', function (data) {
                client.close();
                resolve(String(data));
            });
        });
    }
});

// What the control page is told, as the page asks it
async function status_of(servers)
{
    const answer = await fetch_host({port: servers.control.address().port, host: '127.0.0.1', path: '/api/v1/status'});
    return JSON.parse(answer.body);
}

// The apps off the tailnet ("apps": {"ports": null}): no port answers https, so no certificate is
// asked of tailscale, serviceman's name goes into no public log, and nothing is said missing
test('with the apps off the tailnet no certificate is asked, and none is said missing', async function () {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-tailnet-off-'));
    try {
        const app = app_from_config(config_from_json({apps: {ports: null}, services: []}, state));
        await tailnet_cert_read(app);
        assert.strictEqual(app.tailnet_cert.at, 0, 'tailscale was not asked');
        assert.strictEqual(app.log_lines.some(v => /\[tailnet_cert(_error)?\]/.test(v)), false);
        // A refusal from before the switch says nothing now
        app.tailnet_cert.error = '500 Internal Server Error: your Tailscale account does not support getting TLS certs';
        assert.deepStrictEqual(problems_of_tailnet_cert(app), []);
    }
    finally {
        fs.rmSync(state, {recursive: true, force: true});
    }
});

// "apps": {"http_said": false}, the switch on the Tailscale page: the apps' tailnet links over
// http are said there alone. The page's state carries no https_off and no problem for it, so
// Apps, Addresses, Health and the bar say nothing; it is still found and logged as it was, and
// set back on it is said again at the page's next look, since when it began
test('with http said on the Tailscale page alone, the page\'s state and Health say nothing of it', async function (t) {
    assert.strictEqual(config_from_json({services: []}, '/srv/serviceman').apps.http_said, true, 'said everywhere unless set');
    assert.strictEqual(config_from_json({apps: {http_said: true}, services: []}, '/srv/serviceman').apps.http_said, true);
    assert.throws(() => config_from_json({apps: {http_said: 'no'}, services: []}, '/srv/serviceman'), /apps\.http_said: true, .* or false, on the Tailscale page alone \(got "no"\)/);

    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-http-said-'));
    const app = app_from_config(config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {ports: 0, http_said: false},
        services: [],
    }, state));
    assert.strictEqual(app.config.apps.http_said, false);
    const servers = await server_start(app);
    t.after(function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        fs.rmSync(state, {recursive: true, force: true});
    });
    app.tailnet_cert.error = '500 Internal Server Error: your Tailscale account does not support getting TLS certs';
    // Seen twice, a check apart, as Health shows a problem
    await problems_check(app);
    app.problems.get('tailnet_cert').first_seen -= 60*1000;
    await problems_check(app);
    assert.strictEqual(app.problems.get('tailnet_cert').shown, true, 'still found');
    assert.strictEqual(app.log_lines.filter(v => v.includes('[problem_begin]')).length, 1, 'and logged');

    const off = await status_of(servers);
    assert.strictEqual(off.apps.http_said, false);
    assert.strictEqual(off.tailnet.https_off, null, 'no note on Apps or Addresses, no http on a link');
    assert.deepStrictEqual(off.problems, [], 'Health neither lists nor counts it, nor does the bar');

    app.config.apps.http_said = true;
    const on = await status_of(servers);
    assert.strictEqual(on.tailnet.https_off.why, 'HTTPS is off for your tailnet');
    assert.deepStrictEqual(on.problems.map(v => [v.subject, v.since]), [['No https for the apps: HTTPS is off for your tailnet', app.problems.get('tailnet_cert').first_seen]]);

    // The apps taken off the tailnet: nothing missing, from the moment it is saved, not at the
    // next check
    app.config.apps.ports = null;
    assert.deepStrictEqual((await status_of(servers)).problems, []);
    app.config.apps.ports = 0;

    app.config.apps.http_said = false;
    await problems_check(app);
    assert.strictEqual(app.log_lines.some(v => v.includes('[problem_end]')), false, 'unsaid is not mended');
});
