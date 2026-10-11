// What the door does with this name: {service, wall, off}, or null for a name it was never
// given. `*.example.com` is every name under it and not the bare name itself; an exact name is
// read before any wildcard that would carry it.
function agent_door_rule(table, host)
{
    if (table === null) {
        return null;
    }
    const names = table.names;
    if (names[host] !== undefined) {
        return names[host];
    }
    for (const pattern of Object.keys(names)) {
        if (pattern.startsWith('*.') && (host.length > pattern.length - 1) && host.endsWith(pattern.slice(1))) {
            return names[pattern];
        }
    }
    return null;
}

module.exports = agent_door_rule;
