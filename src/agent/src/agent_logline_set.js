const agent_logline_path = require('./agent_logline_path');
const agent_logline_read = require('./agent_logline_read');
const file_write_synced = require('./file_write_synced');

// serviceman says where this machine's lines go — {endpoint, token, logs: "all", dirs} — or
// that they go nowhere, {logs: "off"}. `dirs` are the folders whose files are read besides the
// containers: [{path, service}]. It is on disk before anything acts on it: after a restart the
// agent starts from this file, so a machine whose serviceman is away still ships to the
// endpoint it last heard of.
//
// The floor is the moment collection was switched on. Every line from it on is kept; a telling
// that changes only the endpoint or the token keeps the floor where it is. Switched off and on
// again, the floor is the new moment.
function agent_logline_set(params)
{
    const logs = (((params !== undefined) && (params.logs === 'all')) ? 'all' : 'off');
    if ((logs === 'all') && ((typeof params.endpoint !== 'string') || (typeof params.token !== 'string'))) {
        throw new Error('logs "all" needs an endpoint and a token');
    }
    const was = agent_logline_read();
    const settings = {
        endpoint: ((logs === 'all') ? params.endpoint : null),
        token: ((logs === 'all') ? params.token : null),
        logs,
        floor: ((logs === 'off') ? null : (((was.logs === 'all') && (was.floor !== null)) ? was.floor : new Date().toISOString())),
        dirs: (((logs === 'all') && Array.isArray(params.dirs)) ? params.dirs.map(v => ({path: String(v.path), service: (((v.service === undefined) || (v.service === null)) ? null : String(v.service))})) : []),
    };
    if (JSON.stringify(settings) !== JSON.stringify(was)) {
        // Mode 600: the token lets this machine write to the log
        file_write_synced(agent_logline_path('settings.json'), `${JSON.stringify(settings, null, 4)}\n`);
    }
    return {logs: settings.logs, floor: settings.floor};
}

module.exports = agent_logline_set;
