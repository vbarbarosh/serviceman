const config_file_save = require('./config_file_save');
const config_from_file = require('./config_from_file');
const config_locked = require('./config_locked');
const fs = require('fs');

// The forwards that are part of a database server made the ones that show up at `ends`, each
// {to, tls, allow}: a forward's `to` ({remote, port}, {remote, socket}, {here: true, port}, or
// its public port, {remote: <its machine>, port, host: '0.0.0.0'}), and for a public port
// whether it speaks TLS and who it lets in; or, `ends` null, where they show up now: each from
// the server's machine and its port now, labelled `mongodb-1 → vps2` (`mongodb-1 → the
// internet` for its public port), a number added when the label is taken. A forward still
// showing up where it did keeps its label, which the page, its counts and its logs know it by,
// and whether it is set aside.
// They go where the first of them was in the config, or at the end; every other forward stays
// as it was, where it was. The file is written and applied only when it changes. A list the
// config refuses throws what the config says.
//
//     server  {name, remote, port} as databases_read keeps it; `ends` [] takes them all out
//
// Answers {labels, removed}: the labels of the forwards now part of it, and of those taken out.
function database_forwards_put(app, server, ends)
{
    if (app.config.path === undefined) {
        throw new Error('serviceman runs without a config file');
    }
    return config_locked(app, () => forwards_write(app, server, ends));
}

async function forwards_write(app, server, ends)
{
    // app_apply_config starts the services, and a database server's start asks for this file
    const app_apply_config = require('./app_apply_config');
    const text = await fs.promises.readFile(app.config.path, 'utf8');
    const json = JSON.parse(text);
    const all = Array.isArray(json.forwards) ? json.forwards : [];
    const before = all.filter(v => is_part(v, server.name));
    const kept = all.filter(v => (is_part(v, server.name) === false));
    const at = (before.length === 0) ? kept.length : all.findIndex(v => is_part(v, server.name));
    const labels = kept.map(v => (((v === null) || (typeof v !== 'object')) ? '' : (v.label || v.name)));
    const now = [];
    for (const end of ((ends === null) ? before.map(v => ({to: v.to, tls: v.tls, allow: v.allow})) : ends)) {
        const to = end.to;
        const found = before.find(v => same_place(v.to, to));
        const label = (found === undefined) ? label_free(`${server.name} → ${place_word(to)}`, labels) : found.label;
        labels.push(label);
        const forward = Object.assign({label, database: server.name, from: {remote: server.remote, port: server.port}, to}, (end.tls === true) ? {tls: true} : {}, (Array.isArray(end.allow) && (end.allow.length > 0)) ? {allow: end.allow} : {});
        if ((found !== undefined) && (found.off === true)) {
            forward.off = true;
        }
        now.push(forward);
    }
    const forwards = kept.slice(0, at).concat(now, kept.slice(at));
    if (forwards.length === 0) {
        delete json.forwards;
    }
    else {
        json.forwards = forwards;
    }
    const out = {labels: now.map(v => v.label), removed: before.filter(v => (now.some(vv => vv.label === v.label) === false)).map(v => v.label)};
    const written = `${JSON.stringify(json, null, 4)}\n`;
    if (written === `${JSON.stringify(JSON.parse(text), null, 4)}\n`) {
        return out;
    }
    const config = config_from_file(app, json);
    await config_file_save(app.config.path, written);
    await app_apply_config(app, config);
    return out;
}

function is_part(forward, name)
{
    return (forward !== null) && (typeof forward === 'object') && (forward.database === name);
}

// Where a forward shows up: the same machine, or serviceman itself, the same port or socket, and
// its loopback or every address
function same_place(a, b)
{
    if ((a === null) || (typeof a !== 'object') || (b === null) || (typeof b !== 'object')) {
        return false;
    }
    return ['remote', 'here', 'port', 'socket', 'host'].every(v => (a[v] === b[v]));
}

// Where a forward shows up, in its label
function place_word(to)
{
    if (to.here === true) {
        return 'this host';
    }
    return (to.host === '0.0.0.0') ? 'the internet' : to.remote;
}

// The first of label, label 2, label 3… that no other forward has
function label_free(label, labels)
{
    if (labels.includes(label) === false) {
        return label;
    }
    for (let i = 2; ; i++) {
        if (labels.includes(`${label} ${i}`) === false) {
            return `${label} ${i}`;
        }
    }
}

module.exports = database_forwards_put;
