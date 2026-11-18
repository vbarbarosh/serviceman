#!/usr/bin/env node

// serviceman-mcp: an MCP server over stdio, for a coding agent in a box (Visual Agency) to put
// an app it made on serviceman and come back with its link. A client writes one JSON-RPC 2.0
// message a line on stdin, and the answers go one a line on stdout; nothing else is written
// there. Its tools are app_send (src/app_send.js) and app_list (src/app_list.js). It runs on
// node alone, with nothing from npm, so that it can be handed to a box as one file:
// bundler/mcp_bundle.js makes it, and serviceman serves it at GET /api/v1/serviceman-mcp.js.
//
//     SERVICEMAN_TOKEN   a token of serviceman's with the apps right, sent with every call
//     SERVICEMAN_SOCKET  serviceman's control socket, /sockets/serviceman.sock when unset

const line_answer = require('./src/line_answer');
const readline = require('readline');

const USAGE = `serviceman-mcp

An MCP server on stdin and stdout, started by a coding agent: it puts a folder of files on
serviceman as an app, answers its link, and lists the apps the agent may send to. From
serviceman's checkout, or as one file in a box
(GET /api/v1/serviceman-mcp.js, docs/mcp.md):

    claude mcp add serviceman -- bin/serviceman-mcp
    claude mcp add serviceman --env SERVICEMAN_TOKEN=<token> -- node serviceman-mcp.js

  SERVICEMAN_TOKEN   a token of serviceman's with the apps right
  SERVICEMAN_SOCKET  serviceman's control socket (default /sockets/serviceman.sock)
`;

main();

function main()
{
    if (process.argv.includes('--help')) {
        process.stdout.write(USAGE);
        return;
    }
    // Each line is answered as soon as it is ready, so a ping is not kept behind an app on
    // its way; the client matches the answers by their ids
    const lines = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
    lines.on('line', function (line) {
        if (line.trim() === '') {
            return;
        }
        line_answer(line).then(answer_write);
    });
}

function answer_write(answer)
{
    if (answer !== null) {
        process.stdout.write(`${JSON.stringify(answer)}\n`);
    }
}
