// The k6 script of one load test: its users ask for one address for its duration. `ip`, when
// given, is where the address's name is sent instead of asking DNS: a .localhost name is
// serviceman's own, and nothing but serviceman knows where it is.
function k6_script(test, url, ip)
{
    const host = new URL(url).hostname;
    const options = {
        vus: test.vus,
        duration: test.duration,
        hosts: (ip === null) ? {} : {[host]: ip},
        thresholds: {},
        summaryTrendStats: ['med', 'p(95)', 'max', 'avg'],
        discardResponseBodies: true,
    };
    if (test.p95_ms !== null) {
        options.thresholds.http_req_duration = [`p(95)<${test.p95_ms}`];
    }
    if (test.errors_pct !== null) {
        options.thresholds.http_req_failed = [`rate<=${test.errors_pct/100}`];
    }
    return `import http from 'k6/http';

export const options = ${JSON.stringify(options, null, 4)};

// Each user says what its first bad answer was, once; the run collects them, counted
let told = false;

export default function () {
    const res = http.get(${JSON.stringify(url)});
    if ((told === false) && ((res.status === 0) || (res.status >= 400))) {
        told = true;
        console.warn((res.status === 0) ? res.error : \`answered \${res.status}\`);
    }
}
`;
}

module.exports = k6_script;
