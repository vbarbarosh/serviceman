const RE_ENDPOINT = /^https?:\/\/[^\s/]+\/[^\s?#]*$/;
const RE_SECRET = /^[A-Za-z0-9_.-]+$/;
const RE_UI = /^https?:\/\/[^\s/]+(\/[^\s?#]*)?$/;

// Where Logline is, and the secret serviceman asks it for tokens with — or null, when this
// host sends nobody's lines anywhere:
//
//     "logline": {"endpoint": "http://logline:3000/lines", "admin": "logline", "ui": "http://logline:8081/"}
//
// `admin` names a secret in the Secrets library; the value itself is never in the config.
// `ui` is where Logline's viewer is, for the page to open; optional.
function logline_from_json(json, label)
{
    if ((json === undefined) || (json === null)) {
        return null;
    }
    if ((typeof json !== 'object') || Array.isArray(json)) {
        throw new Error(`${label}: {"endpoint": "http://logline:3000/lines", "admin": "<a secret in the Secrets library>"}`);
    }
    if ((typeof json.endpoint !== 'string') || (RE_ENDPOINT.test(json.endpoint) === false)) {
        throw new Error(`${label}.endpoint: the address machines POST their lines to, such as "http://logline:3000/lines" (got ${JSON.stringify(json.endpoint)})`);
    }
    if ((typeof json.admin !== 'string') || (RE_SECRET.test(json.admin) === false)) {
        throw new Error(`${label}.admin: the name of the secret in the Secrets library that holds Logline's ADMIN_TOKEN (got ${JSON.stringify(json.admin)})`);
    }
    if ((json.ui !== undefined) && ((typeof json.ui !== 'string') || (RE_UI.test(json.ui) === false))) {
        throw new Error(`${label}.ui: the address of Logline's viewer, such as "http://logline:8081/" (got ${JSON.stringify(json.ui)})`);
    }
    return {endpoint: json.endpoint, admin: json.admin, ui: ((json.ui === undefined) ? null : json.ui)};
}

module.exports = logline_from_json;
