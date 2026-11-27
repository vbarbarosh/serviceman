import service_tab_allowed from './service_tab_allowed.js';

// The tab a service's page shows for the one picked: that one where the service has it, its
// Overview where it does not, and Settings where it has no Overview either (a folder of files,
// an app already running). The pick stays as it was, so the next service that has the tab opens
// on it.
//
//     view     a service of the status: {type: 'files', …}
//     picked   the tab picked: 'logs'
//     ->       'settings'
function service_tab_of(view, picked)
{
    if (service_tab_allowed(view, picked)) {
        return picked;
    }
    return service_tab_allowed(view, 'overview') ? 'overview' : 'settings';
}

export default service_tab_of;
