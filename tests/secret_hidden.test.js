const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
const TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// What the page draws where a token would be: the command whole, the token nowhere in it
test('a token is drawn as dots wherever the text holds it', async function () {
    const secret_hidden = (await import(path.join(PUBLIC, 'secret_hidden.js'))).default;
    const command = `node serviceman-agent.js --url http://192.0.2.10:3001 --token ${TOKEN}`;
    const shown = secret_hidden(command, TOKEN);
    assert.strictEqual(shown.includes(TOKEN), false);
    assert.strictEqual(shown, 'node serviceman-agent.js --url http://192.0.2.10:3001 --token ••••••••••••');
    assert.strictEqual(secret_hidden(`-e A=${TOKEN} -e B=${TOKEN}`, TOKEN), '-e A=•••••••••••• -e B=••••••••••••');
    assert.strictEqual(secret_hidden(TOKEN, TOKEN), '••••••••••••');
});

// No token known yet: the text is drawn as it is, the placeholder of an unread config too
test('a text with no token known is drawn as it is', async function () {
    const secret_hidden = (await import(path.join(PUBLIC, 'secret_hidden.js'))).default;
    const command = 'curl -fsSL http://192.0.2.10:3001/api/v1/install.sh | sh -s -- --token <the token in the config>';
    assert.strictEqual(secret_hidden(command, null), command);
    assert.strictEqual(secret_hidden(command, undefined), command);
    assert.strictEqual(secret_hidden(command, ''), command);
    assert.strictEqual(secret_hidden(command, TOKEN), command);
});
