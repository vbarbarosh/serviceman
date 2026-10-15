const assert_service_valid = require('./assert_service_valid');
const duration_ms_from_text = require('./duration_ms_from_text');
const forwards_from_json = require('./forwards_from_json');
const join_from_json = require('./join_from_json');
const lifecycle_from_json = require('./lifecycle_from_json');
const load_tests_from_json = require('./load_tests_from_json');
const logline_from_json = require('./logline_from_json');
const path = require('path');
const program_mark = require('./program_mark');
const remotes_from_json = require('./remotes_from_json');
const upstream_from_text = require('./upstream_from_text');
const volumes_from_json = require('./volumes_from_json');

const DEFAULT_LISTEN_HOST = '127.0.0.1';
const DEFAULT_LISTEN_PORT = 8080;
const DEFAULT_CONTROL_HOST = 'serviceman.localhost';
const DEFAULT_CONTROL_PORT = 8081;
const DEFAULT_CONTROL_BIND = '127.0.0.1';
const DEFAULT_SOCKET_MODE = 0o600;
const DEFAULT_START_TIMEOUT = '120s';
const DEFAULT_START_TRIES = 2;
const DEFAULT_STOP_AFTER_IDLE = '10m';
const DEFAULT_REQUEST_TIMEOUT = '60s';

const DEFAULT_BUSY_UP = 0.7;
const DEFAULT_BUSY_DOWN = 0.2;
const DEFAULT_UP_FOR = '10s';
const DEFAULT_DOWN_FOR = '2m';
const DEFAULT_COOL_DOWN = '1m';
const DEFAULT_SCALE_DOWN_AFTER = '2m';
const DEFAULT_WARMUP_WAIT = '2s';
const DEFAULT_RESTART = 'on_failure';

// The kinds of service an agent starts on its machine; the one other kind already runs
// somewhere, and belongs to no machine of ours
const TYPES_CARRIED = ['docker', 'shell'];

// A `#` in front of a name in a service's remotes asks for a tag instead of one machine
const TAG_MARK = '#';
const RE_TAG = /^[a-z0-9][a-z0-9_-]*$/;

const PUBLISH_FIELDS = ['host', 'hosts', 'port', 'strip_prefix'];

// A handover address is an ordinary http address, with a path at most
const RE_REDIRECT = /^https?:\/\/[^\s/]+(\/[^\s?#]*)?$/;

// Raw serviceman.json -> the config the server runs on: defaults applied, paths absolute, durations in ms
function config_from_json(json, base_dir)
{
    const listen = json.listen || {};
    const control = json.control || {};
    const defaults = json.defaults || {};
    const out = {
        base_dir,
        listen: {
            host: listen.host || DEFAULT_LISTEN_HOST,
            // Zero is a port: it means whichever one is free, and it must survive the default
            port: ((listen.port === undefined) ? DEFAULT_LISTEN_PORT : listen.port),
            socket: ((listen.socket === undefined) ? null : path.resolve(base_dir, listen.socket)),
            socket_mode: mode_from_json(listen.socket_mode, 'listen.socket_mode'),
        },
        control: {
            host: ((control.host === undefined) ? DEFAULT_CONTROL_HOST : control.host),
            port: ((control.port === undefined) ? DEFAULT_CONTROL_PORT : control.port),
            bind: control.bind || DEFAULT_CONTROL_BIND,
            socket: ((control.socket === undefined) ? null : path.resolve(base_dir, control.socket)),
            socket_mode: mode_from_json(control.socket_mode, 'control.socket_mode'),
            exposed: control.exposed === true,
            names: names_from_json(control.names, 'control.names'),
            shell: control.shell !== false,
        },
        // A machine that dials in with an older agent than this host serves is asked to fetch
        // the current one. `false` leaves every machine as it is, to be updated by hand.
        agent_update: json.agent_update !== false,
        join: join_from_json(json.join, 'join'),
        // Where the remotes send their lines, when they send them anywhere
        logline: logline_from_json(json.logline, 'logline'),

        remotes: remotes_from_json(json.remotes, 'remotes'),
        // A port or a socket on one machine, answered on another, through both links
        forwards: forwards_from_json(json.forwards, 'forwards'),
        services: [],
        // What k6 is sent at, and from where
        load_tests: load_tests_from_json(json.load_tests, 'load_tests'),
    };
    const service_defaults = defaults;
    if (Array.isArray(json.services) === false) {
        throw new Error('services: an array of service definitions is required');
    }
    const names = [];
    const claims = [];
    for (let i = 0; i < json.services.length; i++) {
        const service = service_from_json(json.services[i], service_defaults, base_dir, `services[${i}]`);
        for (const name of service.remotes) {
            if (name.startsWith(TAG_MARK)) {
                // A tag is not checked against the config: a machine says what it is when it
                // connects, so a tag nothing carries today may be carried an hour from now. The
                // boot says which tags nothing answers yet, and a service with no machine waits
                // instead of failing to load.
                continue;
            }
            if (out.remotes.some(v => v.name === name) === false) {
                throw new Error(`services[${i}].remotes: no remote named ${JSON.stringify(name)} is in the config`);
            }
        }
        if (names.includes(service.name)) {
            throw new Error(`services[${i}].name: ${JSON.stringify(service.name)} is used twice`);
        }
        for (const route of service.routes) {
            const claim = `${route.host}${route.path}`;
            if (claims.includes(claim)) {
                throw new Error(`services[${i}].publish.host: ${JSON.stringify(claim)} is used twice`);
            }
            if ((out.control.host !== null) && (route.host === out.control.host)) {
                throw new Error(`services[${i}].publish.host: ${JSON.stringify(route.host)} is the control page hostname`);
            }

            claims.push(claim);
        }
        names.push(service.name);
        out.services.push(service);
    }
    // A door says which service answers each of its names, and may name a wall to ask before
    // anything is answered at all. Neither can be a service that is not in the config: a rule
    // naming one is a rule nothing could ever act on.
    for (const remote of out.remotes) {
        for (const host of Object.keys(remote.inbound)) {
            const rule = remote.inbound[host];
            const label = `remotes: ${JSON.stringify(remote.name)} answers ${JSON.stringify(host)}`;
            if (names.includes(rule.service) === false) {
                throw new Error(`${label} with the service ${JSON.stringify(rule.service)}, and no service has that name`);
            }
            if ((rule.auth !== null) && (names.includes(rule.auth) === false)) {
                throw new Error(`${label} behind ${JSON.stringify(rule.auth)}, and no service has that name`);
            }
            if (rule.auth === rule.service) {
                throw new Error(`${label} behind itself — a wall and what it guards are two services`);
            }
        }
    }
    for (let i = 0; i < out.forwards.length; i++) {
        for (const end of ['from', 'to']) {
            const name = out.forwards[i][end].remote;
            if (out.remotes.some(v => v.name === name) === false) {
                throw new Error(`forwards[${i}].${end}.remote: no remote named ${JSON.stringify(name)} is in the config`);
            }
        }
    }
    for (let i = 0; i < out.load_tests.length; i++) {
        const test = out.load_tests[i];
        if (names.includes(test.service) === false) {
            throw new Error(`load_tests[${i}].service: no service named ${JSON.stringify(test.service)} is in the config`);
        }
        if (out.remotes.some(v => v.name === test.remote) === false) {
            throw new Error(`load_tests[${i}].remote: no remote named ${JSON.stringify(test.remote)} is in the config`);
        }
    }
    return out;
}

// Where a service may run, in the order it is tried: a machine by name, or `#tag` for every
// machine carrying that tag. A container and a program run on a machine with an agent, so each
// names at least one. Something already running names none — or the one machine it already
// runs on, when it is reached through that machine's link.
function remotes_from_service(json, label)
{
    if ((json.remotes === undefined) && (json.remote === undefined)) {
        if (TYPES_CARRIED.includes(json.type)) {
            throw new Error(`${label}.remotes: a ${json.type} service runs on a machine with an agent — name one, or a #tag`);
        }
        return [];
    }
    if (TYPES_CARRIED.includes(json.type) === false) {
        if ((json.remotes !== undefined) || (typeof json.remote !== 'string') || (json.remote === '') || json.remote.startsWith(TAG_MARK)) {
            throw new Error(`${label}.remote: an external service runs where it already runs — name the one machine it is on as "remote", or none for this one`);
        }
        return [json.remote];
    }
    if ((json.remote !== undefined) && (json.remotes !== undefined)) {
        throw new Error(`${label}.remotes: write one of "remote" or "remotes", not both`);
    }
    const out = ((json.remote === undefined) ? json.remotes : [json.remote]);
    if ((Array.isArray(out) === false) || (out.length === 0)) {
        throw new Error(`${label}.remotes: a list of remote names is required, in the order they are tried`);
    }
    for (const name of out) {
        if ((typeof name !== 'string') || (name === '')) {
            throw new Error(`${label}.remotes: a remote name is a non-empty string (got ${JSON.stringify(name)})`);
        }
        if (name.startsWith(TAG_MARK) && (RE_TAG.test(name.slice(TAG_MARK.length)) === false)) {
            throw new Error(`${label}.remotes: a tag is lowercase letters, digits, - and _ (got ${JSON.stringify(name)})`);
        }
    }
    if (new Set(out).size !== out.length) {
        throw new Error(`${label}.remotes: the same remote is named twice`);
    }
    return out;
}

// Who may open the socket file is who may reach the control page through it, so the mode is
// as narrow as a private key by default
function mode_from_json(json, label)
{
    if (json === undefined) {
        return DEFAULT_SOCKET_MODE;
    }
    const out = parseInt(String(json), 8);
    if ((Number.isInteger(out) === false) || (out < 0) || (out > 0o777)) {
        throw new Error(`${label}: a file mode like "0600" is required (got ${JSON.stringify(json)})`);
    }
    return out;
}

// The other names the control page may be asked by, when something in front renames it
function names_from_json(json, label)
{
    if (json === undefined) {
        return [];
    }
    if (Array.isArray(json) === false) {
        throw new Error(`${label}: an array of hostnames is required`);
    }
    for (const item of json) {
        if ((typeof item !== 'string') || (item !== item.toLowerCase()) || (item === '')) {
            throw new Error(`${label}: a lowercase hostname is required (got ${JSON.stringify(item)})`);
        }
    }
    return json;
}

function service_from_json(json, service_defaults, base_dir, label)
{
    assert_publish_used(json, label);
    const publish = json.publish || {};
    const out = {
        name: String(json.name || ''),
        type: String(json.type || ''),
        remotes: remotes_from_service(json, label),
        hosts: hosts_from_json(json, publish, label),
        cwd: null,
        routes: [],
        strip_prefix: publish.strip_prefix === true,
        redirect: redirect_from_json(json.redirect, `${label}.redirect`),
        title: json.title || json.name || '',
        policy: policy_from_json(json.policy || {}, service_defaults, `${label}.policy`),
    };
    out.routes = routes_from_hosts(out.hosts);
    if (out.type === 'docker') {
        out.image = json.image;
        out.port = publish.port;
        out.env = json.env || {};
        out.volumes = volumes_from_json(json.volumes, base_dir, `${label}.volumes`, out.name);
        out.run_args = json.run_args || [];
        out.args = json.args || [];
        out.network = json.network || null;
        // docker's own init as pid 1, unless the image insists on being pid 1 itself — an
        // s6-overlay image quits at once when it is not
        out.init = json.init !== false;
    }
    if (out.type === 'shell') {
        out.command = json.command;
        out.argv = (Array.isArray(json.argv) ? json.argv : null);
        out.port = ((publish.port === undefined) ? null : publish.port);
        out.lifecycle = lifecycle_from_json(json.lifecycle, `${label}.lifecycle`);
        // The environment the lines run in. Without one they run on the machine itself; with
        // one they run inside it, with the program's folder mounted at /app.
        out.image = ((json.image === undefined) ? null : String(json.image));
        // Who it runs as inside that image: `node:node` for a node image, `1000:1000` for a
        // number. Without one, the user running serviceman or the agent, by number.
        out.user = ((json.user === undefined) ? null : String(json.user));
        // Storage, for a program that keeps something. It lives on one machine, which is why
        // a service with a volume may name only one.
        out.volumes = volumes_from_json(json.volumes, base_dir, `${label}.volumes`, out.name);
        // As written, and resolved by the agent on the machine that runs it, against its own
        // home. A program that installs itself gets a folder of its own without being told,
        // because there is nowhere else it could go.
        out.cwd = ((json.cwd === undefined) ? cwd_default(out) : String(json.cwd));
        // A folder serviceman chose is a folder the agent may take away again. One that was
        // named in the config belongs to whoever named it, and is never removed.
        out.cwd_made = ((json.cwd === undefined) && (out.lifecycle.install !== null));
        out.env = json.env || {};
    }
    if (out.type === 'external') {
        if (publish.port !== undefined) {
            throw new Error(`${label}.publish.port: an external service answers where "upstream" says; nothing here has a port inside`);
        }
        // host:port. http://host:port says the same and is read as it; anything more — https, a
        // path — would be taken for part of the host, and is refused
        const bare = ((typeof json.upstream === 'string') ? json.upstream.trim().replace(/^http:\/\/([^/\s]+)\/?$/, '$1') : json.upstream);
        if ((typeof bare === 'string') && /[/\s]/.test(bare)) {
            throw new Error(`${label}.upstream: where it already answers, as host:port — plain http, no path (got ${JSON.stringify(json.upstream)})`);
        }
        out.upstream = upstream_from_text(bare);
        // Nothing here starts it or stops it; it is already running, wherever it runs
        out.policy.start = 'always';
        out.policy.stop_after_idle_ms = null;
    }
    if (out.redirect !== null) {
        if (TYPES_CARRIED.includes(out.type) === false) {
            throw new Error(`${label}.redirect: only a service serviceman starts can be woken and handed over — a ${out.type} service has nothing to wake`);
        }
        // Nobody comes back this way once the visitor is on the other address, so an idle clock
        // would be counting the wrong thing. It is off unless this service asks for one itself,
        // and then it means "this long after the last visitor came through the front door".
        if ((json.policy === undefined) || (json.policy.stop_after_idle === undefined)) {
            out.policy.stop_after_idle_ms = null;
        }
    }
    assert_service_valid(out, label);
    return out;
}

// Where the visitor is sent once the service is up. The address here wakes it; the address there
// is the one the service knows itself by, which is where its cookies and its OAuth callback
// belong — so a session made on it keeps working.
function redirect_from_json(json, label)
{
    if ((json === undefined) || (json === null) || (json === false)) {
        return null;
    }
    if ((typeof json !== 'string') || (RE_REDIRECT.test(json) === false)) {
        throw new Error(`${label}: an http address is required, like "http://localhost:8090" (got ${JSON.stringify(json)})`);
    }
    return json.replace(/\/+$/, '');
}

function cwd_default(service)
{
    // Its name and a suffix of its own: the folder it lands in already says whose it is, and
    // the suffix says this exact one is serviceman's — nothing a person makes by hand will
    // ever be it. The suffix follows the name, so it is the same folder tomorrow: a folder
    // that moved when the install line changed would be a folder `update` could not find.
    if (service.lifecycle.install === null) {
        return null;
    }
    return `${service.name}.${program_mark(service.name).slice(0, 8)}`;
}

function policy_from_json(json, defaults, label)
{
    const instances = Object.assign({}, defaults.instances, json.instances);
    const warmup = Object.assign({}, defaults.warmup, json.warmup);
    return {
        start: first_defined(json.start, defaults.start, 'on_demand'),
        stop_after_idle_ms: duration_ms_from_text(first_defined(json.stop_after_idle, defaults.stop_after_idle, DEFAULT_STOP_AFTER_IDLE), `${label}.stop_after_idle`),
        start_timeout_ms: duration_ms_from_text(first_defined(json.start_timeout, defaults.start_timeout, DEFAULT_START_TIMEOUT), `${label}.start_timeout`),
        // How long it is given to stop by itself before it is made to. Unset, each kind keeps
        // its own: ten seconds for a container, which is what docker gives, and five for a
        // program. A service that flushes something to disk on the way out wants more; one
        // that drops the signal on the floor wants less, and wants fixing.
        stop_timeout_ms: duration_ms_from_text(first_defined(json.stop_timeout, defaults.stop_timeout, null), `${label}.stop_timeout`),
        // How many starts in a row may fail before serviceman stops trying. A service that is
        // broken or unconfigured never starts, and asking it again on every request only
        // repeats the work — a clone, an install — and the failure.
        start_tries: first_defined(json.start_tries, defaults.start_tries, DEFAULT_START_TRIES),
        request_timeout_ms: duration_ms_from_text(first_defined(json.request_timeout, defaults.request_timeout, DEFAULT_REQUEST_TIMEOUT), `${label}.request_timeout`),
        scale_down_after_ms: duration_ms_from_text(first_defined(json.scale_down_after, defaults.scale_down_after, DEFAULT_SCALE_DOWN_AFTER), `${label}.scale_down_after`),
        instances: {
            min: first_defined(instances.min, 0),
            max: first_defined(instances.max, 1),
        },
        restart: first_defined(json.restart, defaults.restart, DEFAULT_RESTART),
        concurrency: concurrency_from_json(first_defined(json.concurrency, defaults.concurrency, null)),
        prepull: first_defined(json.prepull, defaults.prepull, true) !== false,
        autoscale: autoscale_from_json(first_defined(json.autoscale, defaults.autoscale, null), `${label}.autoscale`),
        warmup: {
            queue: first_defined(warmup.queue, 1),
            wait_ms: duration_ms_from_text(first_defined(warmup.wait, DEFAULT_WARMUP_WAIT), `${label}.warmup.wait`),
        },
    };
}

// The pool grows and shrinks by itself when this is written, and only then. `busy` is the share
// of the pool that is working — requests in flight over what the copies can take at once — so
// 0.7 means "start another when the pool is seven tenths full and stays there".
function autoscale_from_json(json, label)
{
    if ((json === null) || (json === undefined) || (json === false)) {
        return null;
    }
    if (typeof json !== 'object') {
        throw new Error(`${label}: a set of thresholds is required`);
    }
    const out = {
        busy_up: share_from_json(first_defined(json.busy_up, DEFAULT_BUSY_UP), `${label}.busy_up`),
        busy_down: share_from_json(first_defined(json.busy_down, DEFAULT_BUSY_DOWN), `${label}.busy_down`),
        up_for_ms: duration_ms_from_text(first_defined(json.up_for, DEFAULT_UP_FOR), `${label}.up_for`),
        down_for_ms: duration_ms_from_text(first_defined(json.down_for, DEFAULT_DOWN_FOR), `${label}.down_for`),
        cool_down_ms: duration_ms_from_text(first_defined(json.cool_down, DEFAULT_COOL_DOWN), `${label}.cool_down`),
    };
    if (out.busy_down >= out.busy_up) {
        throw new Error(`${label}.busy_down: it must be under busy_up (${out.busy_up}), or the pool would grow and shrink on the same number`);
    }
    return out;
}

function share_from_json(value, label)
{
    const out = Number(value);
    if ((Number.isFinite(out) === false) || (out <= 0) || (out > 1)) {
        throw new Error(`${label}: a share of the pool between 0 and 1 is required (got ${JSON.stringify(value)})`);
    }
    return out;
}

function concurrency_from_json(value)
{
    if (value === false) {
        return null;
    }
    return value;
}

function first_defined()
{
    for (const value of arguments) {
        if (value !== undefined) {
            return value;
        }
    }
    return undefined;
}

// "tools.example.com/pdf" -> the hostname and the path prefix it claims; "/" and "" both mean the root
function routes_from_hosts(hosts)
{
    const out = [];
    for (const text of hosts) {
        const at = text.indexOf('/');
        if (at === -1) {
            out.push({host: text, path: ''});
            continue;
        }
        out.push({host: text.slice(0, at), path: text.slice(at).replace(/\/+$/, '')});
    }
    return out;
}

function hosts_from_json(json, publish, label)
{
    if (typeof publish.host === 'string') {
        return [publish.host];
    }
    if (Array.isArray(publish.hosts)) {
        return publish.hosts;
    }
    // A program that serves no port answers nowhere, and needs no address
    if (json.type === 'shell') {
        return [];
    }
    throw new Error(`${label}.publish.host: a hostname (or a hosts array) is required`);
}

// Where a service is answered lives in one place, apart from how it is run
function assert_publish_used(json, label)
{
    for (const name of PUBLISH_FIELDS) {
        if (json[name] !== undefined) {
            throw new Error(`${label}.${name}: ${name} lives inside "publish" — {"publish": {"host": "example.com", "port": 8080}}`);
        }
    }
    if ((json.publish !== undefined) && ((typeof json.publish !== 'object') || (json.publish === null) || Array.isArray(json.publish))) {
        throw new Error(`${label}.publish: an object is required — {"host": "example.com", "port": 8080}`);
    }
}

module.exports = config_from_json;
