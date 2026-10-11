const RE_NAME = /^[a-z0-9][a-z0-9_-]*$/;

const TYPES = ['docker', 'external', 'shell'];

const RESTARTS = ['never', 'on_failure', 'always'];

// Throws on anything that would only fail later, at the first request
function assert_service_valid(service, label)
{
    if (RE_NAME.test(service.name) === false) {
        throw new Error(`${label}.name: expected lowercase letters, digits, - and _ (got ${JSON.stringify(service.name)})`);
    }
    if ((service.hosts.length === 0) && (service.type !== 'shell')) {
        throw new Error(`${label}.publish.host: at least one hostname is required`);
    }
    for (const route of service.routes) {
        assert_host_valid(route.host, label);
        assert_path_valid(route.path, label);
    }
    if (TYPES.includes(service.type) === false) {
        throw new Error(`${label}.type: expected one of ${TYPES.join(', ')} (got ${JSON.stringify(service.type)})`);
    }
    if (service.type === 'docker') {
        assert_text_filled(service.image, `${label}.image`);
        assert_port_valid(service.port, `${label}.publish.port`);
    }
    if (service.type === 'shell') {
        assert_shell_valid(service, label);
    }
    if (service.type === 'external') {
        assert_external_valid(service, label);
    }
    if ((service.type === 'shell') && (service.policy.instances.max !== 1)) {
        throw new Error(`${label}.policy.instances: a program runs as one copy; write a second service for a second copy`);
    }
    // A volume is on the machine that holds it and goes nowhere. A service that keeps data may
    // name one machine and no more: a list to fall back on, or a tag that stands for several,
    // would mean the same service running with somebody else's data — or with none.
    if (((service.volumes === undefined) ? [] : service.volumes).length > 0) {
        if (service.remotes.length !== 1) {
            throw new Error(`${label}.remotes: a service that keeps data names one machine; its volumes are there and go nowhere (got ${JSON.stringify(service.remotes)})`);
        }
        if (service.remotes[0].startsWith('#')) {
            throw new Error(`${label}.remotes: a tag stands for any machine carrying it, and a volume is on one machine — name it`);
        }
    }
    assert_policy_valid(service.policy, `${label}.policy`);
}

// Something that already runs: serviceman gives it an address and passes requests on, and
// never starts it, stops it or asks it to scale
function assert_external_valid(service, label)
{
    if (service.upstream === null) {
        throw new Error(`${label}.upstream: where it already answers is required, as host:port (for example 127.0.0.1:7000)`);
    }
    if (service.policy.instances.max !== 1) {
        throw new Error(`${label}.policy.instances: an external service is one address; serviceman does not start copies of it`);
    }
}

// A program the agent runs for serviceman: with a port it is proxied, without one it only runs
function assert_shell_valid(service, label)
{
    if (service.argv === null) {
        assert_text_filled(service.command, `${label}.command`);
    }
    for (const item of ((service.argv === null) ? [] : service.argv)) {
        assert_text_filled(item, `${label}.argv`);
    }
    if (service.port !== null) {
        assert_port_valid(service.port, `${label}.publish.port`);
        if (service.hosts.length === 0) {
            throw new Error(`${label}.publish.host: a program with a port is served on an address`);
        }
        return;
    }
    if (service.hosts.length > 0) {
        throw new Error(`${label}.publish.port: ${JSON.stringify(service.hosts[0])} needs the port the program listens on`);
    }
    if (service.policy.start !== 'always') {
        throw new Error(`${label}.policy.start: a program without a port has no address to be woken by; it starts with serviceman`);
    }
}

function assert_policy_valid(policy, label)
{
    if ((Number.isInteger(policy.start_tries) === false) || (policy.start_tries < 1)) {
        throw new Error(`${label}.start_tries: expected a whole number of tries, at least 1 (got ${JSON.stringify(policy.start_tries)})`);
    }
    if ((policy.start !== 'on_demand') && (policy.start !== 'always')) {
        throw new Error(`${label}.start: expected on_demand or always (got ${JSON.stringify(policy.start)})`);
    }
    if ((Number.isInteger(policy.instances.min) === false) || (policy.instances.min < 0)) {
        throw new Error(`${label}.instances.min: zero or a positive number is required`);
    }
    if ((Number.isInteger(policy.instances.max) === false) || (policy.instances.max < 1)) {
        throw new Error(`${label}.instances.max: a positive number is required`);
    }
    if (policy.instances.min > policy.instances.max) {
        throw new Error(`${label}.instances: min is above max`);
    }
    if ((policy.concurrency !== null) && ((Number.isInteger(policy.concurrency) === false) || (policy.concurrency < 1))) {
        throw new Error(`${label}.concurrency: a positive number of requests per instance is required (or false)`);
    }
    if ((Number.isInteger(policy.warmup.queue) === false) || (policy.warmup.queue < 1)) {
        throw new Error(`${label}.warmup.queue: a positive number of waiting requests is required`);
    }
    if (RESTARTS.includes(policy.restart) === false) {
        throw new Error(`${label}.restart: expected one of ${RESTARTS.join(', ')} (got ${JSON.stringify(policy.restart)})`);
    }
}

function assert_host_valid(host, label)
{
    if (host !== host.toLowerCase()) {
        throw new Error(`${label}.publish.host: hostnames are matched lowercase, write ${JSON.stringify(host.toLowerCase())}`);
    }
    if (host.includes(':')) {
        throw new Error(`${label}.publish.host: a hostname carries no port or scheme (got ${JSON.stringify(host)})`);
    }
    if (host.length === 0) {
        throw new Error(`${label}.publish.host: empty hostname`);
    }
}

function assert_path_valid(path, label)
{
    if (path === '') {
        return;
    }
    if (/[?#\s]/.test(path)) {
        throw new Error(`${label}.publish.host: a path prefix carries no query, hash or spaces (got ${JSON.stringify(path)})`);
    }
}

function assert_text_filled(value, label)
{
    if ((typeof value === 'string') && (value.length > 0)) {
        return;
    }
    throw new Error(`${label}: a non-empty string is required`);
}

function assert_port_valid(value, label)
{
    if (Number.isInteger(value) && (value > 0) && (value < 65536)) {
        return;
    }
    throw new Error(`${label}: the port the service listens on inside the container is required (got ${JSON.stringify(value)})`);
}

module.exports = assert_service_valid;
