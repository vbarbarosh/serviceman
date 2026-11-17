const RE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const PORT_DEFAULT = 3000;

// The app boards: a page of apps, put together by hand, that answers on the machines it is
// published on and nowhere else. On such a machine its agent listens on 127.0.0.1, at `port`,
// and on that machine alone: the board at its own name under .localhost, each of its apps at
// theirs, straight to the app (board_rules):
//
//     "boards": [
//         {"name": "apps", "machines": ["laptop"], "apps": ["notes", "board"]}
//     ]
//
// `name` is the board's name under .localhost, so a name a browser takes: lowercase letters,
// digits and hyphens. `apps` are services by name, in the order the board shows them; the
// config says whether each is there (config_from_json), and so whether each machine is.
function boards_from_json(json, label)
{
    if ((json === undefined) || (json === null)) {
        return [];
    }
    if (Array.isArray(json) === false) {
        throw new Error(`${label}: a list of boards, [{"name", "machines": [...], "apps": [...]}]`);
    }
    const out = [];
    for (let i = 0; i < json.length; i++) {
        const item = json[i];
        const at = `${label}[${i}]`;
        if ((item === null) || (typeof item !== 'object') || Array.isArray(item)) {
            throw new Error(`${at}: {"name", "machines": [...], "apps": [...]}`);
        }
        for (const key of Object.keys(item)) {
            if (['name', 'machines', 'apps', 'port'].includes(key) === false) {
                throw new Error(`${at}.${key}: not a field of a board — name, machines, apps, port`);
            }
        }
        if ((typeof item.name !== 'string') || (RE_NAME.test(item.name) === false)) {
            throw new Error(`${at}.name: its name under .localhost, lowercase letters, digits and hyphens, as apps (got ${JSON.stringify(item.name)})`);
        }
        if (out.some(v => v.name === item.name)) {
            throw new Error(`${at}.name: ${JSON.stringify(item.name)} is used twice`);
        }
        const machines = names_from_json(item.machines, `${at}.machines`, 'the machines it is published on, by name');
        const apps = names_from_json(item.apps, `${at}.apps`, 'its apps, by name, in the order it shows them');
        const port = (item.port === undefined) ? PORT_DEFAULT : item.port;
        if ((Number.isInteger(port) === false) || (port < 1) || (port > 65535)) {
            throw new Error(`${at}.port: a port from 1 to 65535, ${PORT_DEFAULT} unless said (got ${JSON.stringify(item.port)})`);
        }
        out.push({name: item.name, machines, apps, port});
    }
    return out;
}

// A list of names, each once; empty is a board not published anywhere yet, or with nothing on it
function names_from_json(json, label, what)
{
    if (json === undefined) {
        return [];
    }
    if ((Array.isArray(json) === false) || json.some(v => (typeof v !== 'string') || (v === ''))) {
        throw new Error(`${label}: ${what} (got ${JSON.stringify(json)})`);
    }
    const twice = json.find((v, index) => json.indexOf(v) !== index);
    if (twice !== undefined) {
        throw new Error(`${label}: ${JSON.stringify(twice)} is there twice`);
    }
    return json.slice();
}

boards_from_json.PORT_DEFAULT = PORT_DEFAULT;

module.exports = boards_from_json;
