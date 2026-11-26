const agent_root_there = require('./agent_root_there');
const node_sqlite_refusal_of = require('../../helpers/node_sqlite_refusal_of');

// What this agent can be asked for, by name. It is not a fact of the build alone: a machine
// gains a root half the moment somebody installs one, without the agent restarting — so this
// is asked again on every heartbeat, and the host hears about it within the half minute.
async function agent_can(options)
{
    const out = ['apt', 'disk_list', 'disk_usage', 'disk_usage_live', 'doors', 'file_parts', 'files', 'fs_list', 'fs_room', 'fs_tree', 'fs_tree_typed', 'forwards', 'forwards_dial', 'forwards_public', 'fs_watch', 'folder_copy', 'fs_root', 'logline', 'machine_restart', 'machine_shell', 'metrics', 'metrics_live', 'mounts', 'net_test', 'package_list', 'package_versions', 'peer_streams', 'port_list', 'proc_list', 'program_network', 'screenshot', 'security', 'security_mend', 'shared', 'tar_put', 'term_env', 'term_list', 'term_signal', 'ufw', 'update', 'uptime', 'volumes'];
    if (await agent_root_there(options)) {
        out.push('root');
    }
    // SQLite files are read with this machine's own Node, which has node:sqlite or has not
    if (node_sqlite_refusal_of(process.version) === null) {
        out.push('sqlite_read');
    }
    out.sort();
    return out;
}

module.exports = agent_can;
