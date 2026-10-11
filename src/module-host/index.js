#!/usr/bin/env node

const cli = require('@vbarbarosh/node-helpers/src/cli');
const http = require('http');
const request_answer = require('./src/request_answer');

const USAGE = `module-host

serviceman's modules on this computer, in a page of their own: no serviceman and no agent.
The page is on this computer's loopback only. ufw runs as sudo -n ufw: a sudoers line for ufw,
or the page says sudo wants a password.

  PORT    where it listens (default 3002)
`;

cli(main, v => console.error(`module-host: ${v.message}`));

async function main()
{
    if (process.argv.includes('--help')) {
        console.log(USAGE);
        return;
    }
    const port = Number(process.env.PORT || 3002);
    const server = http.createServer(request_answer);
    await new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    console.log(`module-host: http://localhost:${port}/`);
}
