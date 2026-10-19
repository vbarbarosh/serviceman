const RE_TAG = /^[a-z0-9][a-z0-9_-]*$/;
const RE_PREFIX = /^[a-z0-9][a-z0-9_-]*$/;

const SHORTEST_TOKEN = 16;
const DEFAULT_PREFIX = 'auto-';

// One secret that lets a machine nobody has written down add itself. It is the trust boundary
// of the whole fleet: whoever holds it gets a machine into this config and the work that goes
// with it, so it is a password, not a setting.
//
// A machine may say what it is — `--tag gpu` — but only from `tags_allowed`. A tag in the config
// is a fact about a machine; a tag from a machine is a claim, and a claim is only worth what the
// list allows.
function join_from_json(json, label)
{
    if ((json === undefined) || (json === null)) {
        return null;
    }
    if (typeof json !== 'object') {
        throw new Error(`${label}: a token and the tags a machine may claim are required`);
    }
    if ((typeof json.token !== 'string') || (json.token.length < SHORTEST_TOKEN)) {
        throw new Error(`${label}.token: a secret of at least ${SHORTEST_TOKEN} characters is required — it lets a machine add itself (openssl rand -hex 32)`);
    }
    const prefix = (json.name_prefix === undefined) ? DEFAULT_PREFIX : String(json.name_prefix);
    if (RE_PREFIX.test(prefix) === false) {
        throw new Error(`${label}.name_prefix: lowercase letters, digits, - and _ (got ${JSON.stringify(prefix)})`);
    }
    return {
        token: json.token,
        name_prefix: prefix,
        tags_allowed: tags_allowed_from_json(json.tags_allowed, `${label}.tags_allowed`),
    };
}

function tags_allowed_from_json(json, label)
{
    if (json === undefined) {
        return [];
    }
    if (Array.isArray(json) === false) {
        throw new Error(`${label}: a list of tags a machine may claim is required`);
    }
    const out = [];
    for (const item of json) {
        if ((typeof item !== 'string') || (RE_TAG.test(item) === false)) {
            throw new Error(`${label}: a tag is lowercase letters, digits, - and _ (got ${JSON.stringify(item)})`);
        }
        out.push(item);
    }
    return out;
}

module.exports = join_from_json;
