const app_files_put = require('./app_files_put');
const fs = require('fs');
const path = require('path');

// A new name for an app of files: the names made of the old name go with it (board.localhost is
// pad.localhost, board.apps.example.com is pad.apps.example.com), and so does its folder,
// apps/<name> in the state folder, when serviceman keeps it; a folder the config names stays
// where it is, and so does a name given by hand. Without this the config named the app pad while
// its files stayed in apps/board and it answered on board.localhost: gone under both names.
//
// Changes `after` in place, and gives what moves the folder, to run once the new config is found
// good, or null when nothing moves. A refusal throws, with its status.
//
//     before  the service as the config file has it
//     after   the service the page sends, with its new name
function app_files_rename(app, before, after)
{
    if ((before.name === after.name) || (before.type !== 'files') || (after.type !== 'files')) {
        return null;
    }
    if (app.files_sending.has(before.name)) {
        throw failure(409, `${before.name} is taking a zip now: rename it once that is in`);
    }
    const kept = (folder_given(before) === false) && (folder_given(after) === false);
    const from = path.resolve(app.state_dir, 'apps', before.name);
    const to = path.resolve(app.state_dir, 'apps', after.name);
    if (kept && fs.existsSync(to)) {
        throw failure(409, `apps/${after.name} is there already, left by an app of that name before: send ${after.name} a zip to take it back, or pick another name`);
    }
    const old_names = app_files_put.hosts(app, before.name);
    const new_names = app_files_put.hosts(app, after.name);
    const publish = after.publish;
    if ((typeof publish === 'object') && (publish !== null)) {
        if (typeof publish.host === 'string') {
            publish.host = host_renamed(publish.host, old_names, new_names);
        }
        if (Array.isArray(publish.hosts)) {
            publish.hosts = publish.hosts.map(v => (typeof v === 'string') ? host_renamed(v, old_names, new_names) : v);
        }
    }
    if (kept === false) {
        return null;
    }
    return async function () {
        const there = await fs.promises.stat(from).then(() => true, () => false);
        if (there) {
            await fs.promises.rename(from, to);
        }
    };
}

function folder_given(json)
{
    return (json.folder !== undefined) && (json.folder !== null);
}

// "board.localhost/docs" is "pad.localhost/docs": the host made of the old name, its path kept
function host_renamed(text, old_names, new_names)
{
    const at = text.indexOf('/');
    const host = (at === -1) ? text : text.slice(0, at);
    const found = old_names.indexOf(host);
    if (found === -1) {
        return text;
    }
    return new_names[found] + ((at === -1) ? '' : text.slice(at));
}

function failure(status, text)
{
    return Object.assign(new Error(text), {status});
}

module.exports = app_files_rename;
