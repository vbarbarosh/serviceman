const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
const LAPTOP = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SERVER = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const JOIN = 'aaaabbbbccccddddaaaabbbbccccddddaaaabbbbccccddddaaaabbbbccccdddd';

// A config as the editor gets it: two machines, the join block, and a service whose own words
// hold the same letters as a token
const CONFIG = JSON.stringify({
    services: [{name: 'notes', type: 'shell', command: `echo ${LAPTOP}`, remote: 'laptop'}],
    remotes: [{name: 'laptop', token: LAPTOP}, {name: 'server', token: SERVER, tags: ['gpu']}],
    join: {token: JOIN, tags: ['gpu']},
}, null, 4);

async function load()
{
    const hidden = (await import(path.join(PUBLIC, 'config_tokens_hidden.js'))).default;
    const back = (await import(path.join(PUBLIC, 'config_tokens_back.js'))).default;
    return {hidden, back};
}

// What the editor draws: no token anywhere in it, each one dots and a number of its own
test('the config editor draws every token as dots', async function () {
    const {hidden} = await load();
    const shown = hidden(CONFIG);
    assert.strictEqual(shown.text.includes(SERVER), false);
    assert.strictEqual(shown.text.includes(JOIN), false);
    assert.strictEqual(shown.text.includes('"token": "•••••••••••• 1"'), true);
    assert.strictEqual(shown.text.includes('"token": "•••••••••••• 2"'), true);
    assert.strictEqual(shown.text.includes('"token": "•••••••••••• 3"'), true);
    // A command is not a token: it is shown as written, the same letters or not
    assert.strictEqual(shown.text.includes(`"command": "echo ${LAPTOP}"`), true);
    assert.strictEqual(shown.kept.length, 3);
});

// Save untouched: the very text that came, byte for byte
test('a save with the dots untouched sends the config as it was', async function () {
    const {hidden, back} = await load();
    const shown = hidden(CONFIG);
    assert.strictEqual(back(shown.text, shown.kept), CONFIG);
});

// Blocks moved in the editor: each token goes back to its own machine, not to the place it was
test('a token goes back with its block when the blocks are moved', async function () {
    const {hidden, back} = await load();
    const shown = hidden(CONFIG);
    const moved = JSON.parse(shown.text);
    moved.remotes.reverse();
    const sent = JSON.parse(back(JSON.stringify(moved, null, 4), shown.kept));
    assert.deepStrictEqual(sent.remotes.map(v => [v.name, v.token]), [['server', SERVER], ['laptop', LAPTOP]]);
    assert.strictEqual(sent.join.token, JOIN);
});

// A token written over the dots is the new one; a new machine's token is sent as typed
test('a token written over the dots is saved as written', async function () {
    const {hidden, back} = await load();
    const shown = hidden(CONFIG);
    const fresh = '1111222233334444111122223333444411112222333344441111222233334444';
    const edited = JSON.parse(shown.text);
    edited.remotes[1].token = fresh;
    edited.remotes.push({name: 'desktop', token: fresh.replace(/1/g, '5')});
    const sent = JSON.parse(back(JSON.stringify(edited, null, 4), shown.kept));
    assert.deepStrictEqual(sent.remotes.map(v => v.token), [LAPTOP, fresh, fresh.replace(/1/g, '5')]);
    assert.strictEqual(sent.join.token, JOIN);
});

// The same token in two places is one number, and both go back; an empty one stays empty; a
// config with no token, or one too broken to read, is drawn as it is
test('a shared, an empty or no token is drawn and sent back as it was', async function () {
    const {hidden, back} = await load();
    const twice = `{"remotes": [{"name": "a", "token": "${LAPTOP}"}, {"name": "b", "token":"${LAPTOP}"}], "join": {"token": ""}}`;
    const shown = hidden(twice);
    assert.strictEqual(shown.kept.length, 1);
    assert.strictEqual(shown.text, '{"remotes": [{"name": "a", "token": "•••••••••••• 1"}, {"name": "b", "token":"•••••••••••• 1"}], "join": {"token": ""}}');
    assert.strictEqual(back(shown.text, shown.kept), twice);
    const none = '{"services": []}';
    assert.deepStrictEqual(hidden(none), {text: none, kept: []});
    const broken = `{"remotes": [{"name": "a", "token": "${LAPTOP}"`;
    assert.strictEqual(hidden(broken).text.includes(LAPTOP), false);
    assert.strictEqual(back(hidden(broken).text, hidden(broken).kept), broken);
    // A token with an escaped quote in it is one value, put back whole
    const escaped = '{"token": "ab\\"cd"}';
    assert.strictEqual(back(hidden(escaped).text, hidden(escaped).kept), escaped);
});
