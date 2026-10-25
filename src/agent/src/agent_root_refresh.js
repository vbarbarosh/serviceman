const agent_signed = require('../../helpers/agent_signed');
const fs = require('fs');
const path = require('path');

const KEY_FILE = 'host.pub';
const FILE_MODE = 0o755;

// The root half runs a copy of the agent file that is root's alone, so what the session's
// user may write is never what root runs. An update replaces the session's file; before this
// half steps aside for a new one, it takes that file as its own copy, when it is the host's:
// signed with the key pinned beside the copy at install (bin/install-root). Without a source
// there is nothing to take, as on a machine installed as root, where both halves run the one
// file.
//
//     {refreshed, reason}
function agent_root_refresh(options)
{
    const source = String((options.root_source === undefined) ? '' : options.root_source);
    const own = path.resolve(process.argv[1]);
    if ((source === '') || (path.resolve(source) === own)) {
        return {refreshed: false, reason: 'one file for both halves'};
    }
    let text;
    let signature;
    try {
        text = fs.readFileSync(source, 'utf8');
        signature = fs.readFileSync(`${source}.sig`, 'utf8').trim();
    }
    catch (error) {
        return {refreshed: false, reason: `${source}: ${error.message}`};
    }
    const key = key_read(path.join(path.dirname(own), KEY_FILE));
    if (key === null) {
        return {refreshed: false, reason: 'no host key is pinned beside the root copy: sudo bin/install-root pins it'};
    }
    if (agent_signed(text, signature, key) === false) {
        return {refreshed: false, reason: `${source} is not signed by the host this machine was installed from`};
    }
    fs.writeFileSync(`${own}.new`, text, {mode: FILE_MODE});
    fs.renameSync(`${own}.new`, own);
    return {refreshed: true};
}

function key_read(file)
{
    try {
        const key = fs.readFileSync(file, 'utf8').trim();
        return (key === '') ? null : key;
    }
    catch {
        return null;
    }
}

module.exports = agent_root_refresh;
