// Where shared folders keep what they need on a machine: the juicefs program, the table of
// mounts, the read cache and, on their home, the Redis and the Garage. Root's alone, outside the
// agent's own folder, which an uninstall tells its owner to remove with rm -rf.
function agent_shared_dir(options)
{
    if ((options !== undefined) && (options !== null) && (options.shared_dir !== undefined) && (options.shared_dir !== '')) {
        return options.shared_dir;
    }
    return '/var/lib/serviceman/shared';
}

module.exports = agent_shared_dir;
