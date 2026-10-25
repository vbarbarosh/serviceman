#!/usr/bin/env node

const cli = require('@vbarbarosh/node-helpers/src/cli');
const server_make = require('./src/server_make');
const token_from_env = require('./src/token_from_env');

const USAGE = `web-terminal

A terminal in a web page. /<name> is a kept session: close the page, open it again, and the
same terminal is there. / is a terminal that ends when its page closes. The page asks for a
token first, since a terminal is a shell for whoever reaches it.

  PORT                where it listens (default 3000)
  WEB_TERMINAL_TOKEN  the token the page asks for; one is made and printed when it is not set
`;

cli(main, v => console.error(`web-terminal: ${v.message}`));

async function main()
{
    if (process.argv.includes('--help')) {
        console.log(USAGE);
        return;
    }
    const port = Number(process.env.PORT || 3000);
    const server = server_make(token_from_env(process.env, v => console.log(v)));
    await new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(port, resolve);
    });
    console.log(`web-terminal: http://localhost:${port}/`);
}
