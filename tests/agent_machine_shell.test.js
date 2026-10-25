const agent_machine_shell = require('../src/agent/src/agent_machine_shell');
const assert = require('assert');
const test = require('node:test');

// The pty holder is python under the shell: a size it cannot set must not end it, since the
// shell, and whoever sits at it, would go with it
test('a machine shell lives through a size no window has, and still answers what is typed', async function () {
    const shell = agent_machine_shell({cols: 80, rows: 24});
    let heard = '';
    shell.on('data', v => heard += v.toString('utf8'));
    try {
        await heard_until(() => /\$|#|>/.test(heard), 15000, 'the prompt');
        shell.resize('x&y=1', '{}');
        shell.resize(70000, 24);
        shell.resize(80, -1);
        shell.resize(120, 40);
        shell.write('echo $((40+2))\n');
        // The answer stands at a line's start, after the shell's own echo of the line typed
        await heard_until(() => /[\r\n]42\r?\n/.test(heard), 15000, 'the answer');
        assert.match(heard, /42/);
    }
    finally {
        shell.destroy();
    }
});

function heard_until(check, limit_ms, what)
{
    return new Promise(function (resolve, reject) {
        const began = Date.now();
        (function look() {
            if (check()) {
                resolve();
                return;
            }
            if ((Date.now() - began) > limit_ms) {
                reject(new Error(`${what} did not come within ${limit_ms}ms`));
                return;
            }
            setTimeout(look, 50);
        })();
    });
}
