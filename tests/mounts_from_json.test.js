const assert = require('assert');
const mounts_from_json = require('../src/main/src/helpers/mounts_from_json');
const test = require('node:test');

test('a mount is read as written, read-only unless it says rw', function () {
    const mounts = mounts_from_json([
        {label: 'photos', from: {remote: 'laptop', path: '~/Pictures'}, to: {remote: 'vps1', path: '/mnt/photos'}},
        {label: 'data', from: {here: true, path: '.'}, to: {remote: 'vps1', path: '/mnt/serviceman'}, mode: 'rw', off: true},
    ], 'mounts');
    assert.deepStrictEqual(mounts, [
        {label: 'photos', from: {remote: 'laptop', here: false, path: '~/Pictures'}, to: {remote: 'vps1', path: '/mnt/photos'}, mode: 'ro', off: false},
        {label: 'data', from: {remote: null, here: true, path: '.'}, to: {remote: 'vps1', path: '/mnt/serviceman'}, mode: 'rw', off: true},
    ]);
});

test('a mount that reaches past its folder or over the system\'s own is refused', function () {
    const photos = {label: 'photos', from: {remote: 'laptop', path: '~/Pictures'}, to: {remote: 'vps1', path: '/mnt/photos'}};
    for (const [item, words] of [
        [{from: {here: true, path: '../secret'}}, /never through \.\./],
        [{from: {here: true, path: '/etc'}}, /inside serviceman's state dir/],
        [{from: {remote: 'laptop', path: '/'}}, /whole disk/],
        [{from: {remote: 'vps1', path: '~/x'}}, /another machine than its own/],
        [{to: {remote: 'vps1', path: '/etc/photos'}}, /under \/etc/],
        [{to: {remote: 'vps1', path: '/mnt'}}, /one level deeper/],
        [{to: {remote: 'vps1', path: '/mnt/../etc/x'}}, /a full path/],
        [{to: {here: true, path: '/mnt/x'}}, /serviceman itself mounts nothing/],
        [{mode: 'rwx'}, /"ro" for read-only/],
    ]) {
        assert.throws(() => mounts_from_json([Object.assign({}, photos, item)], 'mounts'), words, JSON.stringify(item));
    }
    assert.throws(() => mounts_from_json([photos, Object.assign({}, photos, {label: 'inside', to: {remote: 'vps1', path: '/mnt/photos/inside'}})], 'mounts'), /one inside the other/);
});
