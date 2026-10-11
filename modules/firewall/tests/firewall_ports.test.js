const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = ['203.0.113.7', '100.64.0.21'];

// The page's own file, which the browser imports: the same code decides what the tab says
async function firewall_ports_load()
{
    return (await import(path.join(__dirname, '..', 'ui', 'firewall_ports.js'))).default;
}

test('a port is judged by its address and by the first rule for it that holds for everyone', async function () {
    const firewall_ports = await firewall_ports_load();
    const items = [
        socket('tcp', '0.0.0.0', 22, 'sshd'),
        socket('tcp', '::', 22, 'sshd'),
        socket('tcp', '0.0.0.0', 80, 'nginx'),
        socket('tcp', '0.0.0.0', 443, 'nginx'),
        socket('tcp', '0.0.0.0', 5432, 'postgres'),
        socket('udp', '0.0.0.0', 8050, 'game'),
        socket('tcp', '0.0.0.0', 8050, 'game'),
        socket('tcp', '0.0.0.0', 2222, 'sshd-alt'),
        socket('tcp', '127.0.0.1', 6379, 'redis'),
        socket('tcp', '100.64.0.21', 9000, 'admin'),
    ];
    const firewall = {installed: true, active: true, defaults: {incoming: 'deny', outgoing: 'allow'}, rules: [
        rule('allow 22/tcp', {action: 'allow', port: '22', proto: 'tcp'}),
        rule('deny 80/tcp', {action: 'deny', port: '80', proto: 'tcp'}),
        rule('allow 80/tcp', {action: 'allow', port: '80', proto: 'tcp'}),
        rule('allow 443', {action: 'allow', port: '443'}),
        rule('allow from 10.0.0.0/8 to any port 5432 proto tcp', {action: 'allow', port: '5432', proto: 'tcp', from: '10.0.0.0/8'}),
        rule('deny 8000:8100/udp', {action: 'deny', port: '8000:8100', proto: 'udp'}),
        rule('limit 2222/tcp', {action: 'limit', port: '2222', proto: 'tcp'}),
    ]};
    const rows = firewall_ports(items, PUBLIC, firewall);
    const said = Object.fromEntries(rows.map(v => [`${v.port}/${v.proto}`, [v.reach.exposure, v.verdict.kind, v.verdict.text, ((v.verdict.rule === null) ? null : v.verdict.rule.command)]]));
    assert.deepStrictEqual(said, {
        '22/tcp': ['open', 'open', 'let in', 'allow 22/tcp'],
        '80/tcp': ['open', 'closed', 'kept out', 'deny 80/tcp'],
        '443/tcp': ['open', 'open', 'let in', 'allow 443'],
        '5432/tcp': ['open', 'closed', 'kept out by the default, but from 10.0.0.0/8', null],
        '8050/udp': ['open', 'closed', 'kept out', 'deny 8000:8100/udp'],
        '8050/tcp': ['open', 'closed', 'kept out by the default', null],
        '2222/tcp': ['open', 'open', 'let in, slowed down', 'limit 2222/tcp'],
        '6379/tcp': ['local', 'local', 'only this machine can reach it', null],
        '9000/tcp': ['network', 'closed', 'kept out by the default', null],
    });
    assert.strictEqual(rows.filter(v => v.port === 22).length, 1, 'v4 and v6 of one program are one row');
    assert.deepStrictEqual(rows.find(v => v.port === 22).addresses, ['0.0.0.0', '::']);
    assert.deepStrictEqual(rows.map(v => v.reach.exposure).slice(-2), ['network', 'local'], 'the most exposed come first');
});

test('while the firewall is off, a port says nothing stands in its way, and what it will be once on', async function () {
    const firewall_ports = await firewall_ports_load();
    const items = [socket('tcp', '0.0.0.0', 22, 'sshd'), socket('tcp', '0.0.0.0', 80, 'nginx')];
    const off = {installed: true, active: false, defaults: null, rules: [rule('allow OpenSSH', {action: 'allow', app: 'OpenSSH'})]};
    const rows = firewall_ports(items, PUBLIC, off);
    assert.deepStrictEqual(rows.map(v => [v.port, v.verdict.kind, v.verdict.now, v.verdict.text]), [
        [22, 'open', false, 'once on: let in'],
        [80, 'closed', false, 'once on: kept out by the default'],
    ]);
    // A default that lets everything in, and a machine whose ufw is not known yet or not there
    const open = firewall_ports(items, PUBLIC, {installed: true, active: true, defaults: {incoming: 'allow'}, rules: []});
    assert.deepStrictEqual(open.map(v => v.verdict.text), ['let in by the default', 'let in by the default']);
    assert.deepStrictEqual(firewall_ports(items, PUBLIC, null).map(v => v.verdict.kind), ['unknown', 'unknown']);
    assert.deepStrictEqual(firewall_ports(items, PUBLIC, {installed: false, rules: []}).map(v => v.verdict.text), ['no ufw on this machine', 'no ufw on this machine']);
    // A machine with no public address: every address reaches a network, not the internet
    assert.deepStrictEqual(firewall_ports(items, ['192.168.1.5'], off).map(v => v.reach.exposure), ['network', 'network']);
    // mDNS, WS-Discovery and a broadcast listener: groups of the network around, not the internet
    const groups = [socket('udp', '224.0.0.251', 5353, 'chrome'), socket('udp', '192.168.1.5', 3702, 'wsdd'), socket('udp', '239.255.255.250', 3702, 'wsdd'), socket('udp', 'ff02::c', 3702, 'wsdd'), socket('udp', '255.255.255.255', 67, 'dhcpd')];
    assert.deepStrictEqual(firewall_ports(groups, PUBLIC, off).map(v => [v.port, v.reach.exposure, v.reach.text]), [
        [67, 'network', 'a broadcast'],
        [3702, 'network', 'a private network'],
        [5353, 'network', 'a multicast group'],
    ]);
});

function socket(proto, address, port, name)
{
    return {proto, address, port, state: (proto.startsWith('udp') ? 'UNCONN' : 'LISTEN'), users: [{name, pid: 100 + port}]};
}

function rule(command, fields)
{
    return Object.assign({command, action: 'allow', direction: 'in', port: null, proto: null, from: 'any', to: 'any', on: null, comment: null, app: null}, fields);
}
