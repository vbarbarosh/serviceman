const service_is_app = require('./service_is_app');

// When a save sets the apps domain, or moves it, every app gets its name under it written in,
// as an app made after the domain has it from the start: va.apps.example.com beside
// va.localhost. A domain moved takes its old names away; one taken away takes them all. A name
// another service already answers is left to it. The apps are what Apps shows: a folder of
// files, an app folder run as bin/run, a program on a socket.
//
//     json     the config being saved, as JSON: its apps' publish blocks are written here
//     config   the same config, read (config_from_file): which services are apps
//     before   the domain the running config has, or null
//     out      {added: [name], removed: [name]}, by app
function app_domain_names(json, config, before)
{
    const domain = config.apps.domain;
    const out = {added: [], removed: []};
    if (domain === before) {
        return out;
    }
    const apps = config.services.filter(service_is_app).map(v => v.name);
    for (const entry of json.services) {
        if (apps.includes(entry.name) === false) {
            continue;
        }
        const label = entry.name.replace(/_/g, '-');
        const publish = entry.publish || {};
        let hosts = Array.isArray(publish.hosts) ? publish.hosts.slice() : [publish.host];
        if (before !== null) {
            const old = `${label}.${before}`;
            if (hosts.includes(old) && (hosts.length > 1)) {
                hosts = hosts.filter(v => v !== old);
                out.removed.push(entry.name);
            }
        }
        if (domain !== null) {
            const name = `${label}.${domain}`;
            const taken = json.services.some(v => (v !== entry) && hosts_of(v).some(vv => vv.split('/')[0] === name));
            if ((hosts.includes(name) === false) && (taken === false)) {
                hosts.unshift(name);
                out.added.push(entry.name);
            }
        }
        const rest = Object.assign({}, publish);
        delete rest.host;
        delete rest.hosts;
        entry.publish = Object.assign((hosts.length === 1) ? {host: hosts[0]} : {hosts}, rest);
    }
    return out;
}

function hosts_of(entry)
{
    const publish = entry.publish || {};
    if (Array.isArray(publish.hosts)) {
        return publish.hosts;
    }
    return (typeof publish.host === 'string') ? [publish.host] : [];
}

module.exports = app_domain_names;
