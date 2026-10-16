const cli = require('@vbarbarosh/node-helpers/src/cli');
const terminal_connect = require('./terminal_connect');
const terminals_list = require('./terminals_list');

const LEAVE_KEY = 0x1d;

// node demos/terminal-client/attach.js <remote>            lists its terminals
// node demos/terminal-client/attach.js <remote> <name>     joins one in this tty; Ctrl-] leaves it running
//
// URL is the control port, http://127.0.0.1:8081 by default; SERVICEMAN_TOKEN is the owner's
// token, which bin/owner-token prints: without it serviceman refuses
cli(main, report);

async function main()
{
    const url = process.env.URL || 'http://127.0.0.1:8081';
    const token = process.env.SERVICEMAN_TOKEN;
    const [remote, name] = process.argv.slice(2);
    if (name === undefined) {
        const answer = await terminals_list({url, token, remote});
        for (const item of answer.items) {
            console.log(`${item.name}\t${(item.attached > 0) ? 'open elsewhere' : ''}`);
        }
        return;
    }
    const terminal = terminal_connect({url, token, remote, name, cols: process.stdout.columns, rows: process.stdout.rows});
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

// A refusal for want of a token is said in words: a 401, or a shell socket closed at once when
// no token was given. Anything else as it is.
function report(error)
{
    const given = ((process.env.SERVICEMAN_TOKEN !== undefined) && (process.env.SERVICEMAN_TOKEN !== ''));
    if ((error.status === 401) && given) {
        console.error('serviceman does not know the token in SERVICEMAN_TOKEN: bin/owner-token prints the owner\'s');
        return;
    }
    if ((error.status === 401) || ((error.code === 'ECONNRESET') && (given === false))) {
        console.error('serviceman wants a token: SERVICEMAN_TOKEN=… (bin/owner-token prints the owner\'s)');
        return;
    }
    console.error(error);
}
