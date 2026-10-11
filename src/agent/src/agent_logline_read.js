const agent_logline_path = require('./agent_logline_path');
const fs = require('fs');

// What this machine was last told about Logline — {endpoint, token, logs, floor} — or logs off
// when it was never told anything
function agent_logline_read()
{
    let text;
    try {
        text = fs.readFileSync(agent_logline_path('settings.json'), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return {endpoint: null, token: null, logs: 'off', floor: null, dirs: []};
        }
        throw error;
    }
    // A file from before folders were read names none
    return Object.assign({dirs: []}, JSON.parse(text));
}

module.exports = agent_logline_read;
