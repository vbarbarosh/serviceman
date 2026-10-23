#!/usr/bin/env node

const cli = require('@vbarbarosh/node-helpers/src/cli');
const fs = require('fs');
const http = require('http');
const os = require('os');
const page_key = require('./src/page_key');
const path = require('path');
const request_answer = require('./src/request_answer');
const upgrade_answer = require('./src/upgrade_answer');

const USAGE = `module-host

serviceman's modules on this computer, in a page of their own: no serviceman and no agent to
install. The ServiceMan agent's own code runs in this process and does the work, as the user
who started it. The page is on this computer's loopback only, and opens with the key in the
address it prints, which the user's browser keeps.

Work that wants root (ufw, an upgrade, volumes) goes to the agent's root half when this computer
has one, and to sudo -n where it has not, which answers only where a sudoers line lets it.

  PORT                    where it listens (default 3002)
  SERVICEMAN_AGENT_DIR    where the agent keeps what it keeps: its kept terminals, its log
                          (default ~/.local/state/module-host)
  UFW                     another ufw, such as the Firewall module's fake one
`;

cli(main, v => console.error(`module-host: ${v.message}`));

async function main()
{
    if (process.argv.includes('--help')) {
        console.log(USAGE);
        return;
    }
    const port = Number(process.env.PORT || 3002);
    // The agent keeps its terminals and its log in its own folder, which is never this checkout
    if (!process.env.SERVICEMAN_AGENT_DIR) {
        process.env.SERVICEMAN_AGENT_DIR = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'module-host');
    }
    fs.mkdirSync(process.env.SERVICEMAN_AGENT_DIR, {recursive: true});
    const server = http.createServer(request_answer);
    server.on('upgrade', upgrade_answer);
    await new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    // The key opens the page in this user's browser, and nobody else's (page_key)
    console.log(`module-host: http://localhost:${port}/?key=${page_key()}`);
}
