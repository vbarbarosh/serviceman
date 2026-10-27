const fs = require('fs');
const path = require('path');
const sshd_settings_from_pairs = require('./sshd_settings_from_pairs');

const MAIN = '/etc/ssh/sshd_config';
// A file an Include names without a folder is in sshd's own
const HOME = '/etc/ssh';
// One keyword by two names: the old one still counts, as the same setting
const ALIASES = {challengeresponseauthentication: 'kbdinteractiveauthentication'};

// What sshd goes by, read from its files the way sshd reads them: an Include's files in its
// place, in the order of their names; the first value given to a keyword is the one that
// holds; a Match block, which holds only for some, left out up to its end (another Match that
// is `all`, or the end of its file). A file that cannot be read leaves every value unknown,
// never guessed, and the error names it: `refused` says what reads it instead. `base` is where
// / is, for a test.
//
//     -> {installed, read: 'files', error, password, kbd_interactive, use_pam, root_login, ports}
function sshd_config_from_files(base, refused)
{
    const pairs = new Map();
    const ports = [];
    try {
        file_read(base, MAIN, pairs, ports, true);
    }
    catch (error) {
        const why = (error.code === 'EACCES') ? `permission denied; ${refused}` : ((error.code === 'ENOENT') ? 'not there' : error.message);
        return {installed: true, read: null, error: `${error.file}: ${why}`, password: null, kbd_interactive: null, use_pam: null, root_login: null, ports: []};
    }
    return sshd_settings_from_pairs(pairs, ports, 'files');
}

function file_read(base, file, pairs, ports, main)
{
    let text;
    try {
        text = fs.readFileSync(path.join(base, file), 'utf8');
    }
    catch (error) {
        // An Include that names a file nobody made is nothing to read, as for sshd
        if ((error.code === 'ENOENT') && (main === false)) {
            return;
        }
        throw Object.assign(new Error(error.message), {code: error.code, file});
    }
    let matched = false;
    for (const line of text.split('\n').map(v => v.trim())) {
        const found = /^([^\s=#]+)(?:\s*=\s*|\s+)(.*)$/.exec(line);
        if ((line === '') || line.startsWith('#') || (found === null)) {
            continue;
        }
        const key = ALIASES[found[1].toLowerCase()] || found[1].toLowerCase();
        const value = unquoted(found[2]);
        if (key === 'match') {
            matched = (value.toLowerCase() !== 'all');
            continue;
        }
        if (matched) {
            continue;
        }
        if (key === 'include') {
            for (const name of included(base, value)) {
                file_read(base, name, pairs, ports, false);
            }
        }
        else if (key === 'port') {
            ports.push(parseInt(value, 10));
        }
        else if (pairs.has(key) === false) {
            pairs.set(key, value);
        }
    }
}

// The files an Include names, each pattern in turn: a name with * or ? in it is every file of
// its folder that fits, in the order of their names, the hidden ones left out as a shell does
function included(base, value)
{
    const out = [];
    for (const pattern of value.split(/\s+/).filter(v => v !== '')) {
        const file = pattern.startsWith('/') ? pattern : path.posix.join(HOME, pattern);
        const name = path.posix.basename(file);
        if (/[*?]/.test(name) === false) {
            out.push(file);
            continue;
        }
        const dir = path.posix.dirname(file);
        const fits = new RegExp(`^${name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
        let names;
        try {
            names = fs.readdirSync(path.join(base, dir));
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                continue;
            }
            throw Object.assign(new Error(error.message), {code: error.code, file: dir});
        }
        out.push(...names.filter(v => fits.test(v) && (v.startsWith('.') === false)).sort().map(v => path.posix.join(dir, v)));
    }
    return out;
}

function unquoted(text)
{
    const value = text.trim();
    return ((value.length >= 2) && (value[0] === '"') && (value[value.length - 1] === '"')) ? value.slice(1, -1) : value;
}

module.exports = sshd_config_from_files;
