const agent_root_there = require('./agent_root_there');

// What this agent can be asked for, by name. It is not a fact of the build alone: a machine
// gains a root half the moment somebody installs one, without the agent restarting — so this
// is asked again on every heartbeat, and the host hears about it within the half minute.
async function agent_can(options)
{
    const out = ['apt', 'disk_list', 'disk_usage', 'disk_usage_live', 'doors', 'file_parts', 'files', 'fs_list', 'fs_room', 'fs_tree', 'fs_tree_typed', 'forwards', 'fs_watch', 'folder_copy', 'fs_root', 'logline', 'machine_shell', 'metrics', 'package_list', 'port_list', 'proc_list', 'screenshot', 'security', 'shared', 'tar_put', 'term_env', 'term_list', 'term_signal', 'ufw', 'update', 'uptime', 'volumes'];
    if (await agent_root_there(options)) {
        out.push('root');
    }
    out.sort();
    return out;
}

module.exports = agent_can;
