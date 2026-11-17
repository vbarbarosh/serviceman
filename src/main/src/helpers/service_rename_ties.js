const control_tokens_read = require('./control_tokens_read');
const control_tokens_write = require('./control_tokens_write');
const secrets_read = require('./secrets_read');
const secrets_write = require('./secrets_write');

// What else carries a service's name, moved to its new one. In the config about to be written:
// the machines' door rules that answer for it, or put it in front of another as its wall, the
// services it stands in front of as their own wall, Apps' wall for every app, and the boards it
// is on. Once
// that config is found good: its secrets, and the tokens whose new versions are kept to it.
// Before, a rename of a service a door answered for was refused (the rule named a service nobody
// had), and its secrets and tokens stayed under a name nobody had, read by no program.
//
//     json    the config file, changed in place
//     before  the old name; after the new one
//
// Gives what moves the secrets and the tokens, to run once the config is found good.
function service_rename_ties(app, json, before, after)
{
    // The services it stands in front of, as their own wall
    for (const service of (Array.isArray(json.services) ? json.services : [])) {
        if ((service !== null) && (typeof service === 'object') && (service.auth === before)) {
            service.auth = after;
        }
    }
    // The wall Apps puts in front of the page of apps and every app
    if ((json.apps !== null) && (typeof json.apps === 'object') && (json.apps.auth === before)) {
        json.apps.auth = after;
    }
    // The boards it is on, in its place on each
    for (const board of (Array.isArray(json.boards) ? json.boards : [])) {
        if ((board !== null) && (typeof board === 'object') && Array.isArray(board.apps)) {
            board.apps = board.apps.map(v => (v === before) ? after : v);
        }
    }
    for (const remote of (Array.isArray(json.remotes) ? json.remotes : [])) {
        const inbound = remote.inbound;
        if ((inbound === null) || (typeof inbound !== 'object')) {
            continue;
        }
        for (const host of Object.keys(inbound)) {
            const rule = inbound[host];
            if (rule === before) {
                inbound[host] = after;
                continue;
            }
            if ((rule === null) || (typeof rule !== 'object')) {
                continue;
            }
            if (rule.service === before) {
                rule.service = after;
            }
            if (rule.auth === before) {
                rule.auth = after;
            }
        }
    }
    return function () {
        const secrets = secrets_read(app);
        if (secrets.services[before] !== undefined) {
            secrets.services[after] = secrets.services[before];
            delete secrets.services[before];
            secrets_write(app, secrets);
        }
        const tokens = control_tokens_read(app);
        if (tokens.some(v => Array.isArray(v.services) && v.services.includes(before))) {
            control_tokens_write(app, tokens.map(v => (Array.isArray(v.services) && v.services.includes(before)) ? Object.assign({}, v, {services: v.services.map(vv => (vv === before) ? after : vv)}) : v));
        }
    };
}

module.exports = service_rename_ties;
