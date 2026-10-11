const fs = require('fs');
const secrets_path = require('./secrets_path');

// Everything kept here, in two halves:
//
//   global    a library of secrets, kept once and copied from
//   services  what one service reads, under the names its program asks for
//
// A secret belongs to one service: two services may both want a `token`, and they are not the
// same token. The library is where a value that serves several of them is written down once.
function secrets_read(app)
{
    let text;
    try {
        text = fs.readFileSync(secrets_path(app), 'utf8');
    }
    catch {
        return {global: {}, services: {}};
    }
    const kept = JSON.parse(text);
    if ((kept === null) || (typeof kept !== 'object') || Array.isArray(kept)) {
        return {global: {}, services: {}};
    }
    return {
        global: bag_of(kept.global),
        services: services_of(kept.services),
    };
}

function bag_of(json)
{
    const out = {};
    if ((json === null) || (json === undefined) || (typeof json !== 'object')) {
        return out;
    }
    for (const name of Object.keys(json)) {
        if (typeof json[name] === 'string') {
            out[name] = json[name];
        }
    }
    return out;
}

function services_of(json)
{
    const out = {};
    if ((json === null) || (json === undefined) || (typeof json !== 'object')) {
        return out;
    }
    for (const name of Object.keys(json)) {
        out[name] = bag_of(json[name]);
    }
    return out;
}

module.exports = secrets_read;
