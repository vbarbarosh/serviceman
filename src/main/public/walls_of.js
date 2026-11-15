// The wall a fleet starts with, and the first word of the name of a wall made for a team
const WALL_NAME = 'authwall';

// The walls there are: a service called authwall, one whose name starts with authwall- (a wall
// made for a team on the Authwall page), and any service something stands behind (a service at
// every address, the page of apps, a name of a door). authwall first, then by name; each with
// its team, the title it was given, and how much stands behind it. A wall that something names
// and no service is called is listed too, so the page can say so.
//
//     [{name, team, apps, names, service}]   service: false for a name no service has
function walls_of(state)
{
    const services = state.services;
    const names = new Set(services.map(v => v.name).filter(v => (v === WALL_NAME) || v.startsWith(`${WALL_NAME}-`)));
    for (const item of services) {
        if (is_name(item.auth)) {
            names.add(item.auth);
        }
    }
    if ((state.apps !== undefined) && (state.apps !== null) && is_name(state.apps.auth)) {
        names.add(state.apps.auth);
    }
    for (const rule of rules_of(state)) {
        names.add(rule.auth);
    }
    const sorted = [...names].sort((a, b) => ((a === WALL_NAME) ? -1 : (b === WALL_NAME) ? 1 : a.localeCompare(b)));
    return sorted.map(function (name) {
        const service = services.find(v => v.name === name);
        const team = ((service === undefined) || (service.title === name) || (service.title === '')) ? '' : service.title;
        const apps = services.filter(v => v.auth === name).length;
        const walled = services.filter(v => is_name(v.auth)).map(v => v.name);
        // A name whose service stands behind a wall at every address is counted with that service
        const doors = rules_of(state).filter(v => (v.auth === name) && (walled.includes(v.service) === false)).length;
        return {name, team, apps, names: doors, service: (service !== undefined)};
    });
}

// Every rule of a machine's door that puts a wall in front of its name
function rules_of(state)
{
    const out = [];
    for (const item of state.remotes) {
        const inbound = ((item.inbound === undefined) || (item.inbound === null)) ? {} : item.inbound;
        for (const host of Object.keys(inbound)) {
            const rule = inbound[host];
            if ((typeof rule === 'object') && (rule !== null) && is_name(rule.auth)) {
                out.push({host, service: rule.service, auth: rule.auth});
            }
        }
    }
    return out;
}

function is_name(value)
{
    return (typeof value === 'string') && (value !== '');
}

export default walls_of;
