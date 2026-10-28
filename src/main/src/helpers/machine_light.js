// How one machine stands, as its light on the Canvas says it, and whether work runs on it now.
//
// The light is dark while the machine is away; red when a check on its row of the Health page
// says something there does not work (its Security looks among them), or a service on it
// failed; amber when one says to look; green otherwise. A service is on the machines its copies
// run on, or on those it may run on while none has started. Work is a copy of a service there
// starting or stopping, a service of it doing something (a pull), apt installing, a Docker long
// action, a mend from the Security page: it turns a ring around the light, whatever its colour.
//
//     remote    the machine's view (view_from_remote)
//     health    the Health page (health_from_views)
//     services  the services' views (view_from_service)
//     busy      {apt, docker, mend}: work the views do not show, as the host knows it
//     ->        {light: green | amber | red | dark, work, said: [text]}: said is why, worst first
function machine_light(remote, health, services, busy)
{
    if (remote.phase !== 'online') {
        return {light: 'dark', work: false, said: ['away: its agent is not connected']};
    }
    const bad = [];
    const warn = [];
    const machines = health.areas.find(v => (v.key === 'machines'));
    const row = (machines === undefined) ? undefined : machines.rows.find(v => (v.key === `remote:${remote.name}`));
    for (const item of ((row === undefined) ? [] : row.checks)) {
        if (item.state === 'bad') {
            bad.push(`${item.label}: ${item.text}`);
        }
        if (item.state === 'warn') {
            warn.push(`${item.label}: ${item.text}`);
        }
    }
    const rows = health.areas.find(v => (v.key === 'services'));
    let work = (busy.apt === true) || (busy.docker === true) || (busy.mend === true);
    for (const service of services.filter(v => service_is_on(v, remote.name))) {
        const service_row = (rows === undefined) ? undefined : rows.rows.find(v => (v.key === `service:${service.name}`));
        const state = (service_row === undefined) ? 'none' : service_row.state;
        const worst = (service_row === undefined) ? undefined : service_row.checks.find(v => (v.state === state));
        const said = `${service.title || service.name}: ${(worst === undefined) ? state : worst.text}`;
        if (state === 'bad') {
            bad.push(said);
        }
        if (state === 'warn') {
            warn.push(said);
        }
        const moving = service.instances.some(v => (v.remote === remote.name) && ((v.phase === 'starting') || (v.phase === 'stopping')));
        work = work || moving || (service.doing !== null);
    }
    if (bad.length > 0) {
        return {light: 'red', work, said: bad.concat(warn)};
    }
    if (warn.length > 0) {
        return {light: 'amber', work, said: warn};
    }
    return {light: 'green', work, said: []};
}

// Whether a service is on a machine: a copy of it placed there, or, with none placed yet, the
// machine among those it may run on
function service_is_on(service, name)
{
    const placed = service.instances.filter(v => (v.remote !== null));
    if (placed.length > 0) {
        return placed.some(v => (v.remote === name));
    }
    return Array.isArray(service.remotes) && service.remotes.includes(name);
}

module.exports = machine_light;
