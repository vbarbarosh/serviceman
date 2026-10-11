const cli = require('@vbarbarosh/node-helpers/src/cli');
const terminal_connect = require('./terminal_connect');
const terminals_list = require('./terminals_list');

const LEAVE_KEY = 0x1d;

// node demos/terminal-client/attach.js <remote>            lists its terminals
// node demos/terminal-client/attach.js <remote> <name>     joins one in this tty; Ctrl-] leaves it running
//
// URL is the control port, http://127.0.0.1:8081 by default
cli(main);

async function main()
{
    const url = process.env.URL || 'http://127.0.0.1:8081';
    const [remote, name] = process.argv.slice(2);
    if (name === undefined) {
        const answer = await terminals_list({url, remote});
        for (const item of answer.items) {
            console.log(`${item.name}\t${(item.attached > 0) ? 'open elsewhere' : ''}`);
        }
        return;
    }
    const terminal = terminal_connect({url, remote, name, cols: process.stdout.columns, rows: process.stdout.rows});
    process.stdin.setRawMode(true);
    // Ctrl-], as telnet has it: every other key belongs to the terminal
    process.stdin.on('data', function (chunk) {
        if (chunk.includes(LEAVE_KEY)) {
            terminal.close();
            return;
        }
        terminal.write(chunk.toString('utf8'));
    });
    process.stdout.on('resize', () => terminal.resize(process.stdout.columns, process.stdout.rows));
    terminal.on('data', v => process.stdout.write(v));
    await new Promise(function (resolve, reject) {
        terminal.on('close', resolve);
        terminal.on('error', reject);
    });
    process.stdin.setRawMode(false);
    process.stdin.pause();
}
