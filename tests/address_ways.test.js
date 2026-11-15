const address_ways = require('../src/main/src/helpers/address_ways');
const agent_tailnet = require('../src/agent/src/agent_tailnet');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const control_route_right = require('../src/main/src/helpers/control_route_right');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

// Addresses gives each name its whole way: who opens it, whether it works as far as serviceman
// can tell, and what was measured where it does not

test('a .localhost name is this computer, with nothing to look up', function () {
    const facts = facts_make({services: [{name: 'notes', hosts: ['notes.localhost']}, {name: 'grafana', hosts: ['grafana.localhost/dash']}]});
    const ways = address_ways(facts);
    assert.deepStrictEqual(pick(ways['service notes notes.localhost']), {who: 'this computer', check: 'ok', why: ''});
    assert.deepStrictEqual(pick(ways['service grafana grafana.localhost/dash']), {who: 'this computer', check: 'ok', why: ''});
    assert.deepStrictEqual(address_ways.names(facts), [], 'a .localhost name is never looked up');
});

test('an app\'s own port opens from the tailnet on serviceman\'s tailnet name', function () {
    const facts = facts_make({app_ports: {notes: {port: 3400, error: null}, todo: {port: 3402, error: 'listen EADDRINUSE: address already in use 0.0.0.0:3402'}, board: {port: 3401, error: 'listen EACCES: permission denied 0.0.0.0:3401'}}});
    const ways = address_ways(facts);
    assert.deepStrictEqual(pick(ways['port notes']), {who: 'your tailnet', check: 'ok', why: ''});
    assert.match(ways['port notes'].found, /serviceman\.tail1234\.ts\.net/);
    assert.deepStrictEqual(pick(ways['port todo']), {who: 'your tailnet', check: 'bad', why: 'another program holds 3402'});
    assert.deepStrictEqual(pick(ways['port board']), {who: 'your tailnet', check: 'bad', why: 'port 3401 does not listen: listen EACCES: permission denied 0.0.0.0:3401'});
    // A serviceman with no tailnet name gives no address to open the port at
    facts.tailnet = {name: null, ip: null};
    assert.deepStrictEqual(pick(address_ways(facts)['port notes']), {who: 'your tailnet', check: 'bad', why: 'tailscale gives serviceman no tailnet name'});
});

test('a name under the apps domain is found by serviceman\'s DNS', function () {
    const facts = facts_make({
        apps: {domain: 'apps.internal', dns: 53, address: null},
        services: [{name: 'notes', hosts: ['notes.localhost', 'notes.apps.internal']}, {name: 'board', hosts: ['board.apps.internal']}],
        lookups: {'notes.apps.internal': {addresses: ['100.64.0.20'], error: null}, 'board.apps.internal': {addresses: [], error: 'ENOTFOUND'}},
    });
    const ways = address_ways(facts);
    assert.deepStrictEqual(pick(ways['service notes notes.apps.internal']), {who: 'your tailnet', check: 'ok', why: ''});
    // This computer's DNS does not ask serviceman: whether a device does is not measured here
    assert.deepStrictEqual(pick(ways['service board board.apps.internal']), {who: 'your tailnet', check: 'unsure', why: 'no DNS answer for it here'});
    // No DNS answered by serviceman at all: no device can find them
    facts.apps.dns = null;
    assert.deepStrictEqual(pick(address_ways(facts)['service notes notes.apps.internal']), {who: 'your tailnet', check: 'bad', why: 'serviceman answers no DNS for the apps domain: apps.dns is not set'});
});

test('a name of serviceman\'s own is opened by whoever its DNS leads to serviceman', function () {
    const facts = facts_make({
        services: [{name: 'va', hosts: ['va.example.com']}, {name: 'wiki', hosts: ['wiki.example.com']}, {name: 'dev', hosts: ['dev.example.test']}, {name: 'gone', hosts: ['gone.example.com']}],
        lookups: {
            'va.example.com': {addresses: ['100.64.0.20'], error: null},
            'wiki.example.com': {addresses: ['192.0.2.9'], error: null},
            'dev.example.test': {addresses: ['127.0.0.1'], error: null},
            'gone.example.com': {addresses: [], error: 'ENOTFOUND'},
        },
    });
    const ways = address_ways(facts);
    assert.deepStrictEqual(pick(ways['service va va.example.com']), {who: 'your tailnet', check: 'ok', why: ''});
    assert.deepStrictEqual(pick(ways['service wiki wiki.example.com']), {who: 'anyone', check: 'unsure', why: 'its DNS says 192.0.2.9; serviceman is at 100.64.0.20'});
    assert.deepStrictEqual(pick(ways['service dev dev.example.test']), {who: 'this computer', check: 'ok', why: ''});
    assert.deepStrictEqual(pick(ways['service gone gone.example.com']), {who: '', check: 'bad', why: 'no DNS answer for it here'});
});

test('a public name on a machine\'s door is opened by anyone where its DNS leads to that machine', function () {
    const facts = facts_make({
        remotes: [{name: 'vps1', title: 'vps1', hosts: ['my-site.example.test', 'blog.example.test', 'old.example.test', '*.example.test'], addresses: ['192.0.2.10', '100.64.0.31']}, {name: 'vps2', title: 'vps2', hosts: ['new.example.test'], addresses: null}],
        lookups: {
            'my-site.example.test': {addresses: ['192.0.2.9'], error: null},
            'blog.example.test': {addresses: ['192.0.2.10'], error: null},
            'old.example.test': {addresses: [], error: 'no answer in 3 s'},
            'new.example.test': {addresses: ['192.0.2.20'], error: null},
        },
    });
    const ways = address_ways(facts);
    assert.deepStrictEqual(pick(ways['door vps1 blog.example.test']), {who: 'anyone', check: 'ok', why: ''});
    assert.match(ways['door vps1 blog.example.test'].found, /192\.0\.2\.10, the door of vps1/);
    // An address the machine does not list may be a NAT in front of it: said, not called broken
    assert.deepStrictEqual(pick(ways['door vps1 my-site.example.test']), {who: 'anyone', check: 'unsure', why: 'its DNS says 192.0.2.9; vps1 has 192.0.2.10, 100.64.0.31'});
    assert.deepStrictEqual(pick(ways['door vps1 old.example.test']), {who: '', check: 'bad', why: 'no DNS answer for it here: no answer in 3 s'});
    assert.deepStrictEqual(pick(ways['door vps1 *.example.test']), {who: '', check: 'none', why: 'a pattern: nothing to look up'});
    assert.deepStrictEqual(pick(ways['door vps2 new.example.test']), {who: 'anyone', check: 'unsure', why: 'its DNS says 192.0.2.20; vps2 has not said its addresses yet'});
    // A long answer is said in a line: IPv4 first, the rest counted
    facts.lookups['my-site.example.test'] = {addresses: ['2001:db8::9', '192.0.2.7', '2001:db8::8', '192.0.2.8'], error: null};
    assert.strictEqual(address_ways(facts)['door vps1 my-site.example.test'].why, 'its DNS says 192.0.2.7, 192.0.2.8 and 2 more; vps1 has 192.0.2.10, 100.64.0.31');
    assert.deepStrictEqual(address_ways.names(facts), ['blog.example.test', 'my-site.example.test', 'new.example.test', 'old.example.test']);
});

test('a door name that leads to the machine on the tailnet is opened by the tailnet', function () {
    const facts = facts_make({
        remotes: [{name: 'desktop', title: 'Desktop', hosts: ['music.example.test/radio'], addresses: ['192.168.1.5', '100.64.0.32']}],
        lookups: {'music.example.test': {addresses: ['100.64.0.32'], error: null}},
    });
    assert.deepStrictEqual(pick(address_ways(facts)['door desktop music.example.test/radio']), {who: 'your tailnet', check: 'ok', why: ''});
    facts.lookups['music.example.test'] = {addresses: ['192.168.1.5'], error: null};
    assert.deepStrictEqual(pick(address_ways(facts)['door desktop music.example.test/radio']), {who: 'your network', check: 'ok', why: ''});
});

// The page asks serviceman for every address's way; only the owner may, as for the rest of the
// config. A name under .invalid never resolves anywhere, so the check needs no network.
test('serviceman answers the ways of its addresses to its owner alone', async function (t) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-ways-'));
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {ports: null},
        remotes: [{name: 'vps1', token: '0123456789abcdef0123456789abcdef', inbound: {'gone.example.invalid': 'notes'}}],
        services: [{name: 'notes', type: 'files', publish: {host: 'notes.localhost'}}],
    }, state);
    const app = app_from_config(config);
    const servers = await server_start(app);
    t.after(function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });
    const port = servers.control.address().port;
    const answer = await fetch_host({port, host: 'serviceman.localhost', path: '/api/v1/addresses/ways'});
    assert.strictEqual(answer.status, 200);
    const ways = JSON.parse(answer.body).ways;
    assert.deepStrictEqual(pick(ways['service notes notes.localhost']), {who: 'this computer', check: 'ok', why: ''});
    assert.strictEqual(ways['door vps1 gone.example.invalid'].check, 'bad');
    assert.match(ways['door vps1 gone.example.invalid'].why, /^no DNS answer for it here/);
    assert.strictEqual(control_route_right('GET', '/api/v1/addresses/ways'), null, 'no right a token holds reaches it: the owner\'s alone');
    const stranger = await fetch_host({port, host: 'serviceman.localhost', path: '/api/v1/addresses/ways', token: null});
    assert.notStrictEqual(stranger.status, 200);
});

// The agent reads what tailscale says of this machine
test('the agent reads its tailnet name and address from tailscale', function () {
    const said = JSON.stringify({Self: {DNSName: 'Laptop.tail1234.ts.net.', TailscaleIPs: ['fd7a:115c:a1e0::15', '100.64.0.21']}});
    assert.deepStrictEqual(agent_tailnet.tailnet_of(said), {name: 'laptop.tail1234.ts.net', ip: '100.64.0.21'});
    assert.deepStrictEqual(agent_tailnet.tailnet_of('{"Self": null}'), {name: null, ip: null}, 'logged out');
    assert.deepStrictEqual(agent_tailnet.tailnet_of('not json'), {name: null, ip: null});
    assert.deepStrictEqual(agent_tailnet.tailnet_of(JSON.stringify({Self: {DNSName: 'a b;rm', TailscaleIPs: ['8.8.8.8']}})), {name: null, ip: null}, 'not a name, not a tailnet address');
});

function facts_make(given)
{
    return Object.assign({
        tailnet: {name: 'serviceman.tail1234.ts.net', ip: '100.64.0.20'},
        apps: {domain: null, dns: null, address: null},
        app_ports: {},
        services: [],
        remotes: [],
        lookups: {},
    }, given);
}

function pick(way)
{
    return {who: way.who, check: way.check, why: way.why};
}
