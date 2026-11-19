// What a service is, as its row says it, with its icon: the inside of a 24x24 stroked svg
const KINDS = {
    docker: {word: 'Docker image', icon: '<rect x="3" y="10" width="5" height="4"/><rect x="9" y="10" width="5" height="4"/><rect x="9" y="5" width="5" height="4"/><rect x="15" y="10" width="5" height="4"/><path d="M2 15h20c-1 3.5-4 5.5-9 5.5S3.5 18.5 2 15z"/>'},
    app_folder: {word: 'App folder', icon: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path d="M9 14l2 2 4-4"/>'},
    program: {word: 'Program', icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>'},
    files: {word: 'Folder of files', icon: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>'},
    socket: {word: 'App on a socket', icon: '<path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3"/>'},
    external: {word: 'Already running', icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'},
};

// What a service is, {word, icon}: a docker image, an app folder or a program on a machine, a
// folder of files serviceman serves, an app on a socket file, or an address already running
function service_kind(service)
{
    return KINDS[kind_of(service)];
}

// The key of KINDS a service is
function kind_of(service)
{
    if (service.type === 'docker') {
        return 'docker';
    }
    if (service.type === 'shell') {
        return (service.app_folder === null) ? 'program' : 'app_folder';
    }
    if (service.type === 'files') {
        return 'files';
    }
    return ((service.socket !== null) && (service.socket !== undefined)) ? 'socket' : 'external';
}

export default service_kind;
