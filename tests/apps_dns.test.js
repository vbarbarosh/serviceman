const app_from_config = require('../src/main/src/helpers/app_from_config');
const apps_dns_start = require('../src/main/src/helpers/apps_dns_start');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

// A question as a resolver sends it: one name, its type, recursion asked for
function question(name, type)
{
    const labels = name.split('.').map(function (label) {
        return Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]);
    });
    const head = Buffer.from([0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]);
    const tail = Buffer.alloc(4);
    tail.writeUInt16BE(type, 0);
    tail.writeUInt16BE(1, 2);
    return Buffer.concat([head, ...labels, Buffer.from([0]), tail]);
}

function said(answer)
{
    const count = answer.readUInt16BE(6);
    return {id: answer.readUInt16BE(0), rcode: answer.readUInt16BE(2) & 0x0f, answers: count, address: (count === 0) ? null : Array.from(answer.subarray(answer.length - 4)).join('.')};
}

// Every name under the apps domain is this machine, the domain itself too; another type there is
// an empty answer, a name outside it is refused, and while the address is not known yet the
// asker is told to try again
test('the apps domain\'s names are answered with this machine\'s address, and nothing else is', function () {
    const answer = apps_dns_start.answer;
    assert.deepStrictEqual(said(answer(question('notes.apps.test', 1), 'apps.test', '100.64.0.20')), {id: 0x1234, rcode: 0, answers: 1, address: '100.64.0.20'});
    assert.deepStrictEqual(said(answer(question('Deep.Notes.Apps.Test', 1), 'apps.test', '100.64.0.20')), {id: 0x1234, rcode: 0, answers: 1, address: '100.64.0.20'}, 'names in any case, at any depth');
    assert.deepStrictEqual(said(answer(question('apps.test', 1), 'apps.test', '100.64.0.20')).address, '100.64.0.20', 'the domain itself: the page of cells');
    assert.deepStrictEqual(said(answer(question('notes.apps.test', 28), 'apps.test', '100.64.0.20')), {id: 0x1234, rcode: 0, answers: 0, address: null}, 'no AAAA: the asker takes the A');
    assert.strictEqual(said(answer(question('example.com', 1), 'apps.test', '100.64.0.20')).rcode, 5, 'refused');
    assert.strictEqual(said(answer(question('notapps.test', 1), 'apps.test', '100.64.0.20')).rcode, 5, 'a name that only ends the same way is not under it');
    assert.strictEqual(said(answer(question('notes.apps.test', 1), 'apps.test', null)).rcode, 2, 'no address yet: try again');
    assert.strictEqual(answer(Buffer.from([1, 2, 3]), 'apps.test', '100.64.0.20'), null, 'what is no question gets nothing');
    const answered = Buffer.from(question('notes.apps.test', 1));
    answered.writeUInt16BE(0x8180, 2);
    assert.strictEqual(answer(answered, 'apps.test', '100.64.0.20'), null, 'nor does an answer');
});

// The names are asked over UDP on the port the config gives, opened with the doors
test('serviceman answers the apps\' names on the port its config gives', async function (t) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-dns-'));
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {domain: 'apps.test', dns: 0, address: '100.64.0.20'},
        services: [],
    }, state);
    const app = app_from_config(config);
    const servers = await server_start(app);
    t.after(function () {
        servers.dns.close();
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        fs.rmSync(state, {recursive: true, force: true});
    });
    await servers.dns.ready;
    const port = servers.dns.socket.address().port;
    const client = dgram.createSocket('udp4');
    const answer = await new Promise(function (resolve) {
        client.once('message', resolve);
        client.send(question('notes.apps.test', 1), port, '127.0.0.1');
    });
    client.close();
    assert.deepStrictEqual(said(answer), {id: 0x1234, rcode: 0, answers: 1, address: '100.64.0.20'});
});

test('the apps\' names need a domain, and an address is one', function () {
    function bad(apps) {
        return function () {
            return config_from_json({apps, services: []}, '/srv/serviceman');
        };
    }
    assert.throws(bad({dns: 53}), /names are answered for the apps domain, and there is none/);
    assert.throws(bad({domain: 'apps.test', dns: 'fifty'}), /apps\.dns: the UDP port/);
    assert.throws(bad({domain: 'apps.test', address: '100.64.0'}), /apps\.address: the IPv4 address/);
    assert.throws(bad({domain: 'apps.test', address: '100.64.0.300'}), /apps\.address/);
    assert.deepStrictEqual(config_from_json({apps: {domain: 'apps.test', dns: 53}, services: []}, '/srv/serviceman').apps, {domain: 'apps.test', dns: 53, address: null});
});
