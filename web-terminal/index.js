#!/usr/bin/env node

const cli = require('@vbarbarosh/node-helpers/src/cli');
const http = require('http');
const request_answer = require('./src/request_answer');
const socket_answer = require('./src/socket_answer');

const USAGE = `web-terminal

A terminal in a web page. /<name> is a kept session: close the page, open it again, and the
same terminal is there. / is a terminal that ends when its page closes.

  PORT    where it listens (default 3000)
`;

cli(main, v => console.error(`web-terminal: ${v.message}`));

async function main()
{
    if (process.argv.includes('--help')) {
        console.log(USAGE);
        return;
    }
    const port = Number(process.env.PORT || 3000);
    const server = http.createServer(request_answer);
    server.on('upgrade', socket_answer);
    await new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(port, resolve);
    });
    console.log(`web-terminal: http://localhost:${port}/`);
}
