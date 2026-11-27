// Whether a service shows a tab. Its Overview and its Logs only for what serviceman drives, a
// program or an image: they show the lines it printed, and a folder of files or an app already
// running prints none. The files and a shell of a program on its machine, of a docker service
// inside its container while it runs. Settings always.
//
//     view     a service of the status: {type: 'shell', phase: 'running', …}
//     tab      'overview', 'logs', 'settings', 'files', 'shell'
//     ->       true or false
function service_tab_allowed(view, tab)
{
    if ((tab === 'overview') || (tab === 'logs')) {
        return (view.type !== 'external') && (view.type !== 'files');
    }
    if ((tab === 'files') || (tab === 'shell')) {
        return (view.type === 'shell') || ((view.type === 'docker') && (view.phase === 'running'));
    }
    return true;
}

export default service_tab_allowed;
