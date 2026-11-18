const control_request = require('./control_request');
const path = require('path');
const zip_from_folder = require('./zip_from_folder');

// The tool app_send: a folder of this box sent to serviceman as an app of files under a name
// (PUT /api/v1/apps/<name>), and what an agent is to know of it, in a few lines: its link,
// where that link opens, and whether the app was new or this was a new version of it. What
// failed is thrown as a sentence, serviceman's own when serviceman refused it, for the agent
// to mend the folder or the name and send again.
//
//     args  {name, dir}, as the agent called it
//
//     the text of the result
async function app_send(args)
{
    const name = (typeof args.name === 'string') ? args.name.trim() : '';
    const dir = (typeof args.dir === 'string') ? args.dir.trim() : '';
    if ((name === '') || (dir === '')) {
        throw new Error('app_send takes a name, such as notes, and dir, the path of the app\'s folder');
    }
    // A relative path is read from where this server runs, which is where the agent started it
    const {zip, left} = await zip_from_folder(path.resolve(dir));
    const answer = await control_request('PUT', `/api/v1/apps/${encodeURIComponent(name)}`, zip);
    if ((answer.status !== 200) && (answer.status !== 201)) {
        throw control_request.refusal_of(answer);
    }
    return format_app_sent(answer.json, left);
}

// The tool as tools/list shows it: when to use it is in its description, for the agent
app_send.TOOL = {
    name: 'app_send',
    title: 'Send an app to serviceman',
    description: [
        'Put a web app you made on serviceman and get back its link.',
        'Use it when you have made a page or a small app that is files a browser opens as they are: an index.html at the top of the folder (or in its one subfolder) and what it loads, scripts, styles, pictures; a built site (dist/) is one. Nothing runs on a server for it.',
        'The first send under a name makes the app and answers its link. Send again under the same name for a new version: the link stays, and the new files take the place of the old ones whole.',
        'The whole folder goes, every file at every depth, hidden ones too, but a .git folder and .env files, which are left out and named in the answer; whoever opens the link can fetch every file sent: send the folder that is the app, not a project folder with sources, secrets or node_modules. Links in it are refused; up to 65535 files and 256 MiB.',
        'A name serviceman already has is an app someone made: sending under it replaces that app, or is refused when your token is kept to the apps it makes. Pick a name of your own and keep it for the next versions; app_list shows the apps you may send to.',
    ].join(' '),
    inputSchema: {
        type: 'object',
        properties: {
            name: {type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$', description: 'The app\'s name: lowercase letters, digits, - and _, such as notes. Its link is made of it, and a new version is sent under it.'},
            dir: {type: 'string', description: 'The path of the app\'s folder, the one with its index.html. An absolute path is safest; a relative one is read from the directory this server was started in.'},
        },
        required: ['name', 'dir'],
        additionalProperties: false,
    },
    annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false},
};

// What serviceman said of an app it took, for the agent to pass on: the link first, and last
// what of the folder was left out, never sent
function format_app_sent(said, left)
{
    const lines = [];
    if (said.made) {
        lines.push(`${said.name} is a new app on serviceman, of ${said.files} files.`);
    }
    else {
        lines.push(`${said.name} has a new version on serviceman, of ${said.files} files; the version before it is gone, and its link is the same.`);
    }
    lines.push(`Link: ${said.address} (it opens in a browser on the computer serviceman runs on)`);
    if (said.public === null) {
        lines.push('No name outside: serviceman has no apps domain.');
    }
    else {
        lines.push(`Outside: ${said.public}`);
    }
    if (said.made) {
        lines.push(`A new version goes the same way, under the name ${said.name}.`);
    }
    if (left.length > 0) {
        lines.push(`Left out, never sent: ${left.join(', ')}.`);
    }
    return lines.join('\n');
}

module.exports = app_send;
