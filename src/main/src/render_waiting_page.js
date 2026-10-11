const html_escape = require('./helpers/html_escape');
const render_page = require('./helpers/render_page');
const service_phase = require('./helpers/service_phase');

const POLL_INTERVAL_MS = 1000;

const SCRIPT = `
const time0 = Date.now();
const phase_el = document.getElementById('phase');
const bar_el = document.querySelector('.bar');
const elapsed_el = document.getElementById('elapsed');
const error_el = document.getElementById('error');
const numbers_el = document.getElementById('numbers');
const said_el = document.getElementById('said');
setInterval(function () {
    elapsed_el.textContent = Math.round((Date.now() - time0) / 1000) + 's';
}, 250);
async function tick() {
    try {
        const response = await fetch(prefix + '/__serviceman__/status.json', {cache: 'no-store'});
        const status = await response.json();
        // The step it is on, when there is one worth a name of its own: a four minute
        // download that reads as starting is what makes a start look like a hang
        phase_el.textContent = (status.doing ? status.doing : status.phase);
        numbers_el.textContent = (status.progress_text ? status.progress_text : '');
        bar(status.progress);
        said(status.said);
        if (status.phase === 'running') {
            location.reload();
            return;
        }
        if (status.error) {
            error_el.textContent = status.error;
        }
    }
    catch {
        phase_el.textContent = 'waiting';
    }
    setTimeout(tick, ${POLL_INTERVAL_MS});
}
setTimeout(tick, ${POLL_INTERVAL_MS});

// How far the work is, when it is work that can be measured: a bar that shows a real number
// is the difference between waiting and watching
function bar(ratio) {
    if (typeof ratio !== 'number') {
        bar_el.classList.remove('known');
        bar_el.firstElementChild.style.width = '';
        return;
    }
    bar_el.classList.add('known');
    bar_el.firstElementChild.style.width = Math.max(2, Math.round(ratio * 100)) + '%';
}

// What the machine is saying while it works — the install line's own words, the program's
// first breath. A slow start is a thing being done, not a thing being waited for.
function said(lines) {
    if ((Array.isArray(lines) === false) || (lines.length === 0)) {
        return;
    }
    said_el.hidden = false;
    if (said_el.textContent === lines.join('\\n')) {
        return;
    }
    said_el.textContent = lines.join('\\n');
    said_el.scrollTop = said_el.scrollHeight;
}
`;

// Shown while the container boots; the page reloads itself the moment the service answers
function render_waiting_page(app, service, res, prefix)
{
    const title = html_escape(service.title || service.name);
    const body = `<h1>Starting ${title}</h1>
<p>The service was asleep. It is starting now — this page opens it as soon as it answers.</p>
<div class="bar"><i></i></div>
<p><span id="phase">${html_escape(service_phase(service))}</span> · <span id="elapsed">0s</span></p>
<p class="numbers" id="numbers"></p>
<pre id="said" hidden></pre>
<p class="error" id="error"></p>`;
    const html = render_page({title: `Starting ${title}`, body, script: `const prefix = ${JSON.stringify(prefix || '')};${SCRIPT}`});
    res.writeHead(503, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '2',
    });
    res.end(html);
}

module.exports = render_waiting_page;
