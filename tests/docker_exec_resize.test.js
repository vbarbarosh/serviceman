const assert = require('assert');
const docker_exec_resize = require('../src/main/src/helpers/docker_exec_resize');
const net = require('net');
const test = require('node:test');

test('a resize never fails whoever asked it: an engine that does not answer, an id or a size no request path takes', async function () {
    await docker_exec_resize(connect_nowhere, 'abc', {cols: 80, rows: 24});
    await docker_exec_resize(connect_nowhere, 'abc', {cols: 'x&y=1', rows: {}});
    await docker_exec_resize(connect_nowhere, 'a b/../c', {cols: 80, rows: 24});
    await docker_exec_resize(connect_nowhere, 'abc', {cols: 'a\nb', rows: undefined});
    assert.ok(true, 'each one resolved');
});

// A connection to an engine that is not there
function connect_nowhere()
{
    const out = new net.Socket();
    process.nextTick(() => out.destroy(new Error('no engine here')));
    return out;
}
