const fs = require('fs');
const path = require('path');

// The services stopped by hand, by name: serviceman starts none of them again by itself, not at
// a save of its definition, not when its machine dials in, not when serviceman starts, until it
// is started by hand (Start, Restart, Update). Kept in held.json beside serviceman's other
// state, so a restart keeps it. A service that starts at the first request still wakes on a
// visit, as its policy says.
//
// services_held(app)                  a Set of names
// services_held.set(app, name, held)  held or let go
// services_held.rename(app, from, to) the hold follows a renamed service
function services_held(app)
{
    try {
        const kept = JSON.parse(fs.readFileSync(held_path(app), 'utf8'));
        return new Set(Array.isArray(kept.services) ? kept.services.filter(v => typeof v === 'string') : []);
    }
    catch {
        return new Set();
    }
}

services_held.set = function (app, name, held) {
    const names = services_held(app);
    if (names.has(name) === held) {
        return;
    }
    if (held) {
        names.add(name);
    }
    else {
        names.delete(name);
    }
    write(app, names);
};

services_held.rename = function (app, from, to) {
    const names = services_held(app);
    if (names.has(from) === false) {
        return;
    }
    names.delete(from);
    names.add(to);
    write(app, names);
};

// Written whole and then moved in, so a crash never leaves half a file
function write(app, names)
{
    const file = held_path(app);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify({services: Array.from(names).sort()}, null, 4)}\n`);
    fs.renameSync(`${file}.tmp`, file);
}

function held_path(app)
{
    return path.resolve(app.state_dir, 'held.json');
}

module.exports = services_held;
