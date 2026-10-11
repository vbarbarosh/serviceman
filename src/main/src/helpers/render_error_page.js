const html_escape = require('./html_escape');
const render_page = require('./render_page');

const FIRST_WAIT_MS = 2000;
const LONGEST_WAIT_MS = 15000;

const RETRY_BODY = `
<div class="bar"><i></i></div>
<p><span id="note">Asking again in 2s</span> · <button type="button" id="now">Ask now</button></p>`;

// A service that was not there a second ago is often there now: the page asks again by itself
const RETRY_SCRIPT = `
const note_el = document.getElementById('note');
const now_el = document.getElementById('now');
let wait_ms = ${FIRST_WAIT_MS};
let left_ms = ${FIRST_WAIT_MS};
let asking = false;
now_el.addEventListener('click', function () {
    left_ms = 0;
});
setInterval(function () {
    if (asking) {
        return;
    }
    left_ms -= 250;
    if (left_ms > 0) {
        note_el.textContent = 'Asking again in ' + Math.ceil(left_ms / 1000) + 's';
        return;
    }
    ask();
}, 250);
async function ask() {
    asking = true;
    note_el.textContent = 'Asking again…';
    try {
        const answer = await fetch(location.href, {cache: 'no-store', redirect: 'follow'});
        if (answer.status < 500) {
            location.reload();
            return;
        }
    }
    catch {
    }
    asking = false;
    wait_ms = Math.min(Math.round(wait_ms * 1.6), ${LONGEST_WAIT_MS});
    left_ms = wait_ms;
}
`;

// The only other page serviceman serves in its own name
function render_error_page(res, status, title, detail, options)
{
    const asked = ((options === undefined) ? {} : options);
    const retry = (asked.retry === true);
    // What the machine said while it was trying. A reason is one line; this is the work that
    // produced it, and it is the difference between "it did not start" and knowing why.
    const said = ((Array.isArray(asked.said) && (asked.said.length > 0)) ? `<pre id="said">${html_escape(asked.said.join('\n'))}</pre>` : '');
    const body = `<h1>${html_escape(title)}</h1>
<p class="error">${html_escape(detail)}</p>${said}${retry ? RETRY_BODY : ''}`;
    const html = render_page({title, body, script: (retry ? RETRY_SCRIPT : '')});
    if (res.headersSent) {
        res.destroy();
        return;
    }
    res.writeHead(status, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
    res.end(html);
}

module.exports = render_error_page;
