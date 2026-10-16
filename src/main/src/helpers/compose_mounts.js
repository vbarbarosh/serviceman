// The files and folders of the project each service of a compose file mounts, as `./x:/y`
// under its volumes, by service: {service: ['x', ...]}. Read line by line, for a file written
// the way Logline's is: two spaces a level, volumes as a list.
function compose_mounts(text)
{
    const out = {};
    let section = null;
    let service = null;
    for (const line of text.split('\n')) {
        if (/^\s*(#|$)/.test(line)) {
            continue;
        }
        const top = /^(\S[^:]*):/.exec(line);
        if (top !== null) {
            section = top[1];
            service = null;
            continue;
        }
        const name = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
        if ((section === 'services') && (name !== null)) {
            service = name[1];
            out[service] = [];
            continue;
        }
        const mount = /^\s+-\s+"?\.\/([^:"]+):/.exec(line);
        if ((service !== null) && (mount !== null)) {
            out[service].push(mount[1].replace(/\/$/, ''));
        }
    }
    return out;
}

module.exports = compose_mounts;
