const duration_ms_from_text = require('./duration_ms_from_text');

const RE_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const RE_URL = /^https?:\/\/[^\s/]+(\/[^\s#]*)?$/;
const VUS_MAX = 1000;
const DURATION_MAX_MS = 3600000;

// The load tests k6 runs, each aimed at one service and run from one remote:
//
//     "load_tests": [{"name": "whoami", "service": "whoami", "remote": "phone", "vus": 20, "duration": "30s", "p95_ms": 500, "errors_pct": 1}]
//
// `url` is optional: without it the test asks the service's own address, as serviceman serves it.
function load_tests_from_json(json, label)
{
    if ((json === undefined) || (json === null)) {
        return [];
    }
    if (Array.isArray(json) === false) {
        throw new Error(`${label}: an array of load tests is required`);
    }
    const out = [];
    for (let i = 0; i < json.length; i++) {
        const test = test_from_json(json[i], `${label}[${i}]`);
        if (out.some(v => v.name === test.name)) {
            throw new Error(`${label}[${i}].name: ${JSON.stringify(test.name)} is used twice`);
        }
        out.push(test);
    }
    return out;
}

function test_from_json(json, label)
{
    if ((json === null) || (typeof json !== 'object') || Array.isArray(json)) {
        throw new Error(`${label}: {"name": "whoami", "service": "whoami", "remote": "phone", "vus": 20, "duration": "30s"}`);
    }
    if ((typeof json.name !== 'string') || (RE_NAME.test(json.name) === false)) {
        throw new Error(`${label}.name: lowercase letters, digits, - and _ only, starting with a letter or a digit (got ${JSON.stringify(json.name)})`);
    }
    if ((typeof json.service !== 'string') || (json.service === '')) {
        throw new Error(`${label}.service: the service the test is aimed at (got ${JSON.stringify(json.service)})`);
    }
    if ((typeof json.remote !== 'string') || (json.remote === '')) {
        throw new Error(`${label}.remote: the remote k6 runs on (got ${JSON.stringify(json.remote)})`);
    }
    if ((json.url !== undefined) && ((typeof json.url !== 'string') || (RE_URL.test(json.url) === false))) {
        throw new Error(`${label}.url: an http address, such as "http://whoami.localhost:3000/" (got ${JSON.stringify(json.url)})`);
    }
    if ((Number.isInteger(json.vus) === false) || (json.vus < 1) || (json.vus > VUS_MAX)) {
        throw new Error(`${label}.vus: the number of virtual users, 1 to ${VUS_MAX} (got ${JSON.stringify(json.vus)})`);
    }
    const duration_ms = duration_ms_from_text(json.duration, `${label}.duration`);
    if ((duration_ms === null) || (duration_ms < 1000) || (duration_ms > DURATION_MAX_MS)) {
        throw new Error(`${label}.duration: how long it runs, from 1s to 1h (got ${JSON.stringify(json.duration)})`);
    }
    const p95_ms = (json.p95_ms === undefined) ? null : json.p95_ms;
    if ((p95_ms !== null) && ((typeof p95_ms !== 'number') || (p95_ms <= 0))) {
        throw new Error(`${label}.p95_ms: 95% of answers must come faster than this many ms (got ${JSON.stringify(json.p95_ms)})`);
    }
    const errors_pct = (json.errors_pct === undefined) ? null : json.errors_pct;
    if ((errors_pct !== null) && ((typeof errors_pct !== 'number') || (errors_pct < 0) || (errors_pct > 100))) {
        throw new Error(`${label}.errors_pct: the share of failed answers allowed, 0 to 100 (got ${JSON.stringify(json.errors_pct)})`);
    }
    return {
        name: json.name,
        service: json.service,
        remote: json.remote,
        url: (json.url === undefined) ? null : json.url,
        vus: json.vus,
        duration: String(json.duration),
        duration_ms,
        p95_ms,
        errors_pct,
    };
}

module.exports = load_tests_from_json;
