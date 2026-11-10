import entry_from_form from './entry_from_form.js';

// How the cards write a service (entry_from_form): one machine or a list of them, one address or
// a list, and `publish` and `policy` some keys at a time — a program's cards write no
// `concurrency`, and the cards of something already running no policy at all. `argv` wins over
// `command` and no card shows it, so a line typed into the Command box takes its place: what
// was typed is what runs.
const SHAPE = {
    remote: 'remotes',
    remotes: 'remote',
    command: 'argv',
    publish: {host: 'hosts', hosts: 'host'},
    policy: {},
};

// What one kind of service alone reads and no card shows. It stays through every save but the
// one that makes the service another kind: nothing reads it there, and left in the file it
// would be back, unseen, the day the kind was changed back.
const KIND_KEYS = {docker: ['run_args', 'args'], shell: ['argv']};

// The service a Save of the cards writes: the entry of the config file, changed where the cards
// changed it. `seen` is what the cards write for that entry untouched, `written` what they write
// now. What no card shows — run_args, args, argv, a key written by hand — stays as it was.
function service_from_form(original, seen, written)
{
    const out = entry_from_form(original, seen, written, SHAPE);
    if (written.type !== seen.type) {
        for (const key of (KIND_KEYS[seen.type] || [])) {
            delete out[key];
        }
    }
    return out;
}

export default service_from_form;
