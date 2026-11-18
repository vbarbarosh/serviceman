const control_request = require('./control_request');

// The tool app_list: the apps this box's token may send to with app_send (GET /api/v1/apps), a
// line each with its link, for the agent to find the name of an app it sent before and to see
// which names are taken. A token kept to the apps it makes lists those it made; any other lists
// every app of files on serviceman, each of them someone's, and the text says so: a send under
// one of their names replaces it.
//
//     the text of the result
async function app_list()
{
    const answer = await control_request('GET', '/api/v1/apps', Buffer.alloc(0));
    if (answer.status !== 200) {
        throw control_request.refusal_of(answer);
    }
    return format_apps_listed(answer.json);
}

// The tool as tools/list shows it
app_list.TOOL = {
    name: 'app_list',
    title: 'List the apps on serviceman',
    description: [
        'List the apps you may send to with app_send, each with its link.',
        'With a token kept to the apps it makes, these are the apps it made, and no other name serviceman has is yours to send under; otherwise they are every app of files on serviceman, each one someone\'s.',
        'Use it to find the name of an app you sent before, to send its new version under, or to see which names are taken before you pick one for a new app.',
    ].join(' '),
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
};

// What serviceman listed, for the agent: what the names are, a line each, and what a send under
// one of them does
//
//     said  {apps_own, apps: [{name, kind, address, public}]}
function format_apps_listed(said)
{
    if (said.apps.length === 0) {
        return said.apps_own ? 'This token has made no app yet, and it sends only the apps it makes: app_send under a name of your own makes one.' : 'No app of files is on serviceman yet: app_send under a name of your own makes one.';
    }
    const lines = [];
    if (said.apps_own) {
        lines.push(`The apps this token made, ${said.apps.length}, the only ones it may send to:`);
    }
    else {
        lines.push(`The apps on serviceman, ${said.apps.length}; this token may send under any name, so each is someone's:`);
    }
    for (const item of said.apps) {
        lines.push(format_app_line(item));
    }
    if (said.apps_own) {
        lines.push('app_send under one of these names sends its new version, at the same link; a name of your own makes a new app.');
    }
    else {
        lines.push('app_send under one of these names replaces that app, whoever made it: send under your own app\'s name, or a new one.');
    }
    lines.push('A link opens in a browser on the computer serviceman runs on.');
    return lines.join('\n');
}

// notes: http://notes.localhost:8080/, outside notes.apps.example.com
function format_app_line(item)
{
    const parts = [(item.address === null) ? `${item.name}: no link` : `${item.name}: ${item.address}`];
    if (item.public !== null) {
        parts.push(`outside ${item.public}`);
    }
    if (item.kind === 'socket') {
        parts.push('an app on a socket, which app_send does not send to');
    }
    return parts.join(', ');
}

module.exports = app_list;
