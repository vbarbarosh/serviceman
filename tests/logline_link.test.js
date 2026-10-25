const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');

async function logline_link_of()
{
    global.window = {location: {href: 'https://serviceman.example.com/'}};
    return (await import(path.join(PUBLIC, 'logline_link.js'))).default;
}

function labels_of(url)
{
    return new URL(url).searchParams.getAll('label');
}

test('a service’s Logline link shows the lines of the machines it runs on and no other’s', async function () {
    const logline_link = await logline_link_of();
    const logline = {ui: 'https://logs.example.com/'};

    // A machine's own lines: `remote` is the one label Logline writes from the token, so a
    // machine cannot pass for another
    assert.deepStrictEqual(labels_of(logline_link(logline, 'remote', 'vps1')), ['remote:vps1']);

    // A service's lines come from the machines its config names: a machine not named for it
    // cannot put its lines under this link by labelling them `service:api` (SM-163)
    assert.deepStrictEqual(labels_of(logline_link(logline, 'service', 'api', ['vps1', 'vps2'])), ['service:api', 'service:serviceman-api', 'remote:vps1', 'remote:vps2']);

    // A tag names a kind of machine, not one, and narrows nothing; a service with no machine
    // runs here, and its lines are the host's own, with no `remote` on them
    assert.deepStrictEqual(labels_of(logline_link(logline, 'service', 'api', ['#gpu'])), ['service:api', 'service:serviceman-api']);
    assert.deepStrictEqual(labels_of(logline_link(logline, 'service', 'api', [])), ['service:api', 'service:serviceman-api']);
    assert.deepStrictEqual(labels_of(logline_link(logline, 'service', 'api')), ['service:api', 'service:serviceman-api']);

    // The rest of the link: the viewer, live over the last day; none where no viewer is set
    const url = new URL(logline_link(logline, 'service', 'api', ['vps1']));
    assert.strictEqual(url.origin, 'https://logs.example.com');
    assert.strictEqual(url.searchParams.get('range'), '24h');
    assert.strictEqual(logline_link(null, 'service', 'api', ['vps1']), null);
    assert.strictEqual(logline_link({ui: ''}, 'service', 'api', ['vps1']), null);
});
