const DEFAULT_SOCKET = '/run/serviceman-root.sock';

// Where the root half of this machine answers. It is a file, and who may open it is who may
// ask for root work — which is the whole of the permission, kept by the filesystem.
function agent_root_socket(options)
{
    if ((options !== undefined) && (options.root_socket !== undefined) && (options.root_socket !== '')) {
        return options.root_socket;
    }
    return DEFAULT_SOCKET;
}

module.exports = agent_root_socket;
