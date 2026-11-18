const app_send = require('./app_send');
const mcp_version = require('./mcp_version');

// The versions of MCP spoken here, the newest first: the client's own when it is one of them,
// the newest otherwise. Its tools are the same in each.
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = {name: 'serviceman', title: 'serviceman', version: mcp_version};
const INSTRUCTIONS = 'serviceman serves apps at links of their own. app_send puts a folder of files (a page with its index.html, a built site) on serviceman and answers its link; the same name sent again is a new version at the same link.';
// The tools, by the name an agent calls each by
const TOOL_BY_NAME = new Map([[app_send.TOOL.name, app_send]]);
// JSON-RPC's own codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

// One line a client wrote, answered as MCP over stdio answers it: a JSON-RPC 2.0 message a
// line. A request gets its answer, the result or the error; a notification, initialized and
// cancelled among them, gets none, and neither does an answer to a request, since none is
// made here. A tool that fails is no error of the protocol: it is a result marked isError,
// its sentence for the agent to read, never a stack.
//
//     line  the text of one line, JSON
//
//     {jsonrpc, id, result} or {jsonrpc, id, error}; null for nothing to write
async function line_answer(line)
{
    let message;
    try {
        message = JSON.parse(line);
    }
    catch {
        return refusal_make(null, PARSE_ERROR, 'a message is one JSON object a line');
    }
    const is_object = (message !== null) && (typeof message === 'object') && (Array.isArray(message) === false);
    if (is_object && (typeof message.method !== 'string') && (('result' in message) || ('error' in message))) {
        return null;
    }
    if ((is_object === false) || (typeof message.method !== 'string')) {
        return refusal_make(null, INVALID_REQUEST, 'a message is a JSON-RPC 2.0 request: {jsonrpc, id, method, params}');
    }
    if (message.id === undefined) {
        return null;
    }
    const params = ((message.params !== null) && (typeof message.params === 'object')) ? message.params : {};
    switch (message.method) {
    case 'initialize':
        return answer_make(message.id, {
            protocolVersion: PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
            capabilities: {tools: {}},
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
        });
    case 'ping':
        return answer_make(message.id, {});
    case 'tools/list':
        return answer_make(message.id, {tools: Array.from(TOOL_BY_NAME.values()).map(v => v.TOOL)});
    case 'tools/call':
        return tool_call(message.id, params);
    default:
        return refusal_make(message.id, METHOD_NOT_FOUND, `no method ${message.method} here`);
    }
}

// A tool run: what it said, or the sentence it failed with, marked isError
async function tool_call(id, params)
{
    const tool = TOOL_BY_NAME.get(params.name);
    if (tool === undefined) {
        return refusal_make(id, INVALID_PARAMS, `no tool ${params.name} here: there is ${Array.from(TOOL_BY_NAME.keys()).join(', ')}`);
    }
    const args = ((params.arguments !== null) && (typeof params.arguments === 'object')) ? params.arguments : {};
    try {
        const text = await tool(args);
        return answer_make(id, {content: [{type: 'text', text}], isError: false});
    }
    catch (error) {
        return answer_make(id, {content: [{type: 'text', text: error.message}], isError: true});
    }
}

function answer_make(id, result)
{
    return {jsonrpc: '2.0', id, result};
}

function refusal_make(id, code, message)
{
    return {jsonrpc: '2.0', id, error: {code, message}};
}

module.exports = line_answer;
