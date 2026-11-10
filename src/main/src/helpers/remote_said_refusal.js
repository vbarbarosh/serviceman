// What a machine says of itself, part by part, as everything that reads it takes it to be: the
// status, the Health page, the tellings and every pane of the control page. `resources` is what
// it is, said in its hello; `stats` is what moves, said with the hello and every few seconds.
//
// A kind is text, number or flag, and with `?` null as well; [kind] is a list of them; {'*': kind}
// is one for each name, whatever the names. maybe() is a part an agent may leave out or say
// null: an agent from before it, or one with nothing to say. A part not named here is read by
// nothing, but for the folders Logline reads (`logline.dirs`), only compared as they stand.
const SHAPES = {
    resources: {
        hostname: 'text',
        user: maybe('text'),
        os: maybe('text'),
        platform: 'text',
        arch: 'text',
        node: 'text',
        cpu: {count: 'number', model: 'text'},
        mem: {total: 'number'},
        // null where df did not answer
        disk: {path: 'text', total: 'number?', free: 'number?'},
        docker: 'text?',
        docker_socket: maybe('text'),
        can: maybe(['text']),
        dir: maybe('text'),
        services: maybe('text'),
        addresses: maybe(['text']),
        logline: maybe({logs: maybe('text'), endpoint: maybe('text'), token_sha: maybe('text'), floor: maybe('text')}),
        doors: maybe({version: maybe('text'), peer: maybe({addresses: ['text'], port: 'number'})}),
    },
    stats: {
        can: maybe(['text']),
        uptime_ms: 'number',
        // null, the three of them, while servermon is off or silent
        load: 'number?',
        mem_free: 'number?',
        disk_free: 'number?',
        cpu_busy: maybe('number'),
        disks: maybe({count: 'number', total: 'number', used: 'number'}),
        battery: maybe({percent: 'number', status: 'text'}),
        temperature: maybe({c: 'number', of: 'text'}),
        servermon: maybe({state: 'text', last_at: 'text?'}),
        uptime_30d: maybe({known_ms: 'number', down_ms: 'number'}),
        door: maybe({path: 'text', mode: 'text'}),
        updates: maybe({pending: 'number?', security: 'number?', held: maybe('number'), reboot: 'flag', lists_at: maybe('number')}),
        logline: maybe({
            collecting: 'flag',
            containers: 'number',
            files: maybe('number'),
            dir_errors: maybe({'*': 'text'}),
            sent: {lines: 'number', batches: 'number', bytes: 'number'},
            waiting: {lines: 'number', bytes: 'number', oldest: 'text?'},
            cap_bytes: maybe('number'),
            last_sent_at: 'text?',
            last_answer: 'text?',
            aside: maybe({files: 'number', bytes: 'number', full: 'flag'}),
        }),
        doors_seen: maybe({'*': 'number'}),
    },
};

// Why what a machine said of itself cannot be kept, or null when it can: the first part of it
// that is of another shape, by its path (`resources.mem.total`, `stats.load`). A machine says
// what it will, and what is kept is read for as long as serviceman runs: it is checked here,
// once, before it is kept.
//
//     what   'resources' or 'stats'
function remote_said_refusal(what, said)
{
    return part_odd(said, SHAPES[what], what);
}

function part_odd(said, shape, path)
{
    if (typeof shape === 'string') {
        return kind_fits(said, shape) ? null : path;
    }
    if (shape.maybe !== undefined) {
        return ((said === undefined) || (said === null)) ? null : part_odd(said, shape.maybe, path);
    }
    if (Array.isArray(shape)) {
        return (Array.isArray(said) && said.every(v => kind_fits(v, shape[0]))) ? null : path;
    }
    if ((said === undefined) || (said === null) || (typeof said !== 'object') || Array.isArray(said)) {
        return path;
    }
    // The names of a part that has one for each are the machine's own, and stay out of the path
    const each = shape['*'];
    for (const name of Object.keys((each === undefined) ? shape : said)) {
        const odd = part_odd(said[name], (each === undefined) ? shape[name] : each, (each === undefined) ? `${path}.${name}` : `${path}.*`);
        if (odd !== null) {
            return odd;
        }
    }
    return null;
}

function kind_fits(value, kind)
{
    if (value === null) {
        return kind.endsWith('?');
    }
    if (kind.startsWith('number')) {
        // 1e999 is JSON as well, and reads as a number no page can show
        return Number.isFinite(value);
    }
    return typeof value === (kind.startsWith('text') ? 'string' : 'boolean');
}

function maybe(shape)
{
    return {maybe: shape};
}

module.exports = remote_said_refusal;
