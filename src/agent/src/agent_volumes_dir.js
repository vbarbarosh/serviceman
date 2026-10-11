// Where the volume files are: root's, outside the agent's own folder, which an uninstall tells
// its owner to remove with rm -rf
function agent_volumes_dir(options)
{
    if ((options !== undefined) && (options !== null) && (options.volumes_dir !== undefined) && (options.volumes_dir !== '')) {
        return options.volumes_dir;
    }
    return '/var/lib/serviceman/volumes';
}

module.exports = agent_volumes_dir;
