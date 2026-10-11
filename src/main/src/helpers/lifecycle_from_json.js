// The lines a program has beyond the one that runs it, each one a moment in its life:
//
//   install    the folder is not there yet — put it there
//   update     it is there, and what installs it has changed — bring it up to date
//   stop       it is about to be stopped, for any reason. `SERVICEMAN_REASON` says which
//   uninstall  the service is gone from the config — take the folder with it
//
// Every line is run in the program's folder, through `/bin/sh -c`, on the machine that carries
// the program. What is not written here does not happen: no line is invented for a service.
const STEPS = ['install', 'update', 'stop', 'uninstall'];

function lifecycle_from_json(json, label)
{
    const out = {};
    for (const step of STEPS) {
        out[step] = null;
    }
    if ((json === undefined) || (json === null)) {
        return out;
    }
    if ((typeof json !== 'object') || Array.isArray(json)) {
        throw new Error(`${label}: expected a line for each step, like {"install": "npm install"}`);
    }
    for (const name of Object.keys(json)) {
        if (STEPS.includes(name) === false) {
            throw new Error(`${label}.${name}: expected one of ${STEPS.join(', ')}`);
        }
        if ((typeof json[name] !== 'string') || (json[name].trim() === '')) {
            throw new Error(`${label}.${name}: expected a shell line (got ${JSON.stringify(json[name])})`);
        }
        out[name] = json[name];
    }
    return out;
}

module.exports = lifecycle_from_json;
