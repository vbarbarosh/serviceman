const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
const TOKEN = '0123456789abcdef0123456789abcdef';

// A machine's Install, by its own computed parts: the ways it may dial, named as the page names
// them, the one command with its root half, and each other way's commands, written with what is
// in the field and the machine's token; a socket file's commands reach serviceman through it
test('a machine\'s Install writes the one command and each other way with its address and token', async function () {
    const remote_install = (await import(path.join(PUBLIC, 'remote_install.js'))).default;

    const http = self_of(remote_install, {port: 8081, socket: null});
    assert.deepStrictEqual(http.doors.map(v => [v.label, v.mark, v.hint]), [['address', 'http://tail1234.ts.net:8081', 'this serviceman, as gpu-box reaches it']]);
    http.typed = 'https://serviceman.example.com';
    assert.strictEqual(http.install_text, `curl -fsSL https://serviceman.example.com/api/v1/install.sh | sh -s -- --token ${TOKEN}`);
    http.root_half = true;
    assert.strictEqual(http.install_text, `curl -fsSL https://serviceman.example.com/api/v1/install.sh | sh -s -- --token ${TOKEN} --root`);
    assert.strictEqual(http.fetch_text, 'curl -fsSL https://serviceman.example.com/api/v1/agent.js -o serviceman-agent.js');
    assert.strictEqual(http.run_text, `node serviceman-agent.js --url https://serviceman.example.com --token ${TOKEN}`);
    assert.strictEqual(http.docker_text, `docker run -d --name serviceman-agent --restart always --network host -v /var/run/docker.sock:/var/run/docker.sock -v /:/host:ro -e SERVICEMAN_DIR=/host -e SERVICEMAN_URL=https://serviceman.example.com -e SERVICEMAN_TOKEN=${TOKEN} serviceman-agent`);
    assert.match(http.node_text, /^mkdir -p ~\/bin && v=v24\.\d+\.\d+ && curl -fsSL https:\/\/nodejs\.org\//);
    assert.deepStrictEqual([http.WAYS.map(v => v.label), http.FACTS.length], [['No node', 'By hand', 'Docker', 'The file'], 3]);

    const both = self_of(remote_install, {port: 8081, socket: '/run/serviceman/control.sock'});
    assert.deepStrictEqual(both.doors.map(v => v.label), ['address', 'socket file']);
    both.door_pick(both.doors[1]);
    assert.strictEqual(both.typed, '/run/serviceman/control.sock');
    assert.strictEqual(both.install_text, `curl -fsSL --unix-socket /run/serviceman/control.sock http://localhost/api/v1/install.sh | sh -s -- --token ${TOKEN} --url unix:///run/serviceman/control.sock`);
    assert.strictEqual(both.fetch_text, 'curl -fsSL --unix-socket /run/serviceman/control.sock http://localhost/api/v1/agent.js -o serviceman-agent.js');
    assert.match(both.docker_text, / -v \/run\/serviceman\/control\.sock:\/run\/serviceman\/control\.sock -e SERVICEMAN_URL=unix:\/\/\/run\/serviceman\/control\.sock /);

    const none = self_of(remote_install, {port: null, socket: null});
    assert.deepStrictEqual([none.doors, none.door], [[], null]);
});

// The tab for gpu-box, never dialled in, its token read from the config, as the page gives it
// `control`, serviceman named on its tailnet; its computed parts read as Vue reads them
function self_of(component, control)
{
    const props = {view: {name: 'gpu-box', phase: 'offline'}, control, tailnet: 'tail1234.ts.net'};
    const self = Object.assign({}, component.methods, component.data.call(props), props, {token: TOKEN});
    for (const [key, computed] of Object.entries(component.computed)) {
        Object.defineProperty(self, key, {get: () => computed.call(self)});
    }
    return self;
}
