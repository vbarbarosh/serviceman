const assert = require('assert');
const control_route_right = require('../src/main/src/helpers/control_route_right');
const fs = require('fs');
const module_mount_of = require('../src/main/src/helpers/module_mount_of');
const module_route = require('../src/main/src/helpers/module_route');
const path = require('path');
const test = require('node:test');

// Each mounted module's request handlers, whose doors are written above them as
// `// GET <base>/...`: what the code answers, to hold the manifest against
const SERVES = {
    '/api/v1/remotes/<name>/processes': ['modules/processes/server/processes_serve.js'],
    '/api/v1/remotes/<name>/disks': ['modules/disks/server/disks_serve.js'],
    '/api/v1/remotes/<name>/packages': ['modules/packages/server/packages_serve.js'],
    '/api/v1/remotes/<name>/docker': ['modules/docker/server/docker_serve.js'],
    '/api/v1/remotes/<name>/firewall': ['modules/firewall/server/firewall_serve.js'],
    '/api/v1/remotes/<name>/volumes': ['modules/volumes/server/volumes_serve.js'],
    '/api/v1/remotes/<name>/fs': ['modules/file_manager/server/file_manager_serve.js'],
    '/api/v1/remotes/<name>/terminals': ['modules/terminal/server/terminal_serve.js'],
    '/api/v1/transfers': ['modules/file_manager/server/file_manager_transfers_serve.js'],
};

// What a route says, in the order the tests below write it
function pick(route)
{
    return (route === null) ? null : [route.kind, route.id, route.command, route.door];
}

// The name of the right a request needs, or null for one only the owner has
function right(method, asked)
{
    const found = control_route_right(method, asked);
    return (found === null) ? null : found.right;
}

// Every door a module's code answers, as [method, tail], a word in <> given the example of its
// kind: the kind named before it, or the module's own
function doors_written(mount)
{
    const out = [];
    for (const file of SERVES[mount.base]) {
        const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        for (const found of text.matchAll(/^\s*\/\/ (GET|POST) <base>(\S*)/gm)) {
            const words = found[2].replace(/\?.*$/, '').split('/');
            const tail = words.map(function (word, i) {
                if (/^<[a-z]+>$/.test(word) === false) {
                    return word;
                }
                const kind = mount.manifest.kinds.find(v => (v.kind !== '') && (v.kind === words[i - 1])) || mount.manifest.kinds.find(v => v.kind === '');
                return ((kind === undefined) || (kind.example === undefined)) ? 'a/b.txt' : encodeURIComponent(kind.example);
            }).join('/');
            out.push([found[1], tail]);
        }
    }
    return out;
}

test('every door a module\'s code answers is one its manifest names, and the manifest names no command twice', function () {
    for (const mount of module_mount_of.MODULE_MOUNTS) {
        const written = doors_written(mount);
        assert.notStrictEqual(written.length, 0, `${mount.base} writes its doors down`);
        for (const [method, tail] of written) {
            assert.notStrictEqual(module_route(mount.manifest, method, tail), null, `${mount.manifest.module}: ${method} <base>${tail}`);
        }
        for (const kind of mount.manifest.kinds) {
            const names = kind.commands.map(v => `${v.on} ${v.command}`);
            assert.strictEqual(new Set(names).size, names.length, `${mount.manifest.module} ${kind.kind}`);
            assert.strictEqual(kind.commands.every(v => ['item', 'kind'].includes(v.on)), true);
            assert.strictEqual((kind.id === undefined) || (kind.example === undefined) || new RegExp(`^(?:${kind.id})$`).test(kind.example), true, `${mount.manifest.module} ${kind.kind}: its example is an id`);
        }
    }
});

test('a request is routed to a kind read or made, a command on a kind or on one item, or a door', function () {
    const docker = module_mount_of('/api/v1/remotes/vps1/docker').mount.manifest;
    const packages = module_mount_of('/api/v1/remotes/vps1/packages').mount.manifest;
    const firewall = module_mount_of('/api/v1/remotes/vps1/firewall').mount.manifest;
    assert.deepStrictEqual(pick(module_route(docker, 'GET', '/containers')), ['containers', null, 'read', null]);
    assert.deepStrictEqual(pick(module_route(docker, 'HEAD', '/containers')), ['containers', null, 'read', null]);
    assert.deepStrictEqual(pick(module_route(docker, 'POST', '/containers/3f2a9c1b7d4e/stop')), ['containers', '3f2a9c1b7d4e', 'stop', null]);
    assert.deepStrictEqual(pick(module_route(docker, 'POST', '/images/prune')), ['images', null, 'prune', null]);
    assert.deepStrictEqual(pick(module_route(docker, 'POST', '/volumes/web%20data/open')), ['volumes', 'web data', 'open', null]);
    assert.deepStrictEqual(pick(module_route(docker, 'GET', '/containers/3f2a9c1b7d4e/fs/file/etc/hosts')), [null, null, null, 'containers/<id>/fs']);
    assert.deepStrictEqual(pick(module_route(packages, 'GET', '')), ['', null, 'read', null]);
    assert.deepStrictEqual(pick(module_route(packages, 'GET', '/')), ['', null, 'read', null]);
    assert.deepStrictEqual(pick(module_route(packages, 'POST', '/upgrade')), ['', null, 'upgrade', null]);
    assert.deepStrictEqual(pick(module_route(packages, 'GET', '/upgrade')), ['', null, 'run', null]);
    assert.deepStrictEqual(pick(module_route(firewall, 'POST', '/rules')), ['rules', null, 'create', null]);
    assert.deepStrictEqual(pick(module_route(firewall, 'POST', '/enable')), ['', null, 'enable', null]);

    // What the manifest does not name is no door: another command, a wrong id, a run that is
    // not one, a write where only a read is, a path that goes on
    for (const [manifest, method, tail] of [
        [docker, 'POST', '/containers/3f2a9c1b7d4e/kill'],
        [docker, 'POST', '/containers/abc/stop'],
        [docker, 'GET', '/containers/3f2a9c1b7d4e/stop'],
        [docker, 'GET', '/projects'],
        [docker, 'GET', '/containers/'],
        [docker, 'GET', ''],
        [docker, 'POST', '/volumes/%E0%A4%A/open'],
        [packages, 'GET', '/cancel'],
        [packages, 'POST', ''],
        [packages, 'POST', '/openssl/remove'],
        [packages, 'GET', '/a/b/c'],
        [firewall, 'DELETE', '/rules'],
        [firewall, 'GET', 'rules'],
    ]) {
        assert.strictEqual(module_route(manifest, method, tail), null, `${manifest.module}: ${method} <base>${tail}`);
    }
});

test('a token\'s right to a module is to the doors its manifest gives it, and the whole of one given whole', function () {
    assert.strictEqual(right('GET', '/api/v1/remotes/vps1/packages'), 'packages');
    assert.strictEqual(right('POST', '/api/v1/remotes/vps1/packages/upgrade'), null, 'reading the packages is not installing them');
    assert.strictEqual(right('GET', '/api/v1/remotes/vps1/packages/upgrade'), null);
    assert.strictEqual(right('GET', '/api/v1/remotes/vps1/docker/containers'), 'containers');
    assert.strictEqual(right('POST', '/api/v1/remotes/vps1/docker/containers/3f2a9c1b7d4e/stop'), null, 'reading the containers is not stopping them');
    assert.strictEqual(right('GET', '/api/v1/remotes/vps1/docker/containers/3f2a9c1b7d4e/fs'), null, 'nor reading their files');
    assert.strictEqual(right('POST', '/api/v1/remotes/vps1/terminals/work/signal'), 'terminals');
    assert.strictEqual(right('PUT', '/api/v1/remotes/vps1/fs/anything/at/all'), 'files');
    assert.strictEqual(right('GET', '/api/v1/remotes/vps1/firewall'), null);
    assert.strictEqual(right('GET', '/api/v1/transfers'), null);
    assert.deepStrictEqual(control_route_right('GET', '/api/v1/remotes/a%20b/disks'), {right: 'disks', said: 'read the disks', remote: 'a b'});
});
