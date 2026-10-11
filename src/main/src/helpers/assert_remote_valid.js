const RE_NAME = /^[a-z0-9][a-z0-9_-]*$/;

const SHORTEST_TOKEN = 16;

// Throws on anything that would only fail later, when an agent dials in
function assert_remote_valid(remote, label)
{
    if (RE_NAME.test(remote.name) === false) {
        throw new Error(`${label}.name: expected lowercase letters, digits, - and _ (got ${JSON.stringify(remote.name)})`);
    }
    if ((typeof remote.token !== 'string') || (remote.token.length < SHORTEST_TOKEN)) {
        throw new Error(`${label}.token: a secret of at least ${SHORTEST_TOKEN} characters is required — this token lets another machine run programs for you (openssl rand -hex 32)`);
    }
}

module.exports = assert_remote_valid;
