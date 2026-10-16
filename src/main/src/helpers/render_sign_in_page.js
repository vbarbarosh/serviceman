const render_page = require('./render_page');

const BODY = `
<h1>serviceman</h1>
<p>Paste the owner's token to open the control page. <code>bin/owner-token</code> prints it on the machine serviceman runs on.</p>
<form id="form" style="display: flex; gap: .5rem; margin-top: 1rem;">
    <input id="token" type="password" autocomplete="current-password" placeholder="sm_…" aria-label="The owner's token" spellcheck="false" style="flex: 1; min-width: 0; padding: .3rem .6rem; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--fg); font: inherit;">
    <button type="submit">Open</button>
</form>
<p id="said" class="error" role="alert"></p>`;

// The token goes once, in a POST; the answer is a cookie only this page's own requests carry
const SCRIPT = `
const form_el = document.getElementById('form');
const token_el = document.getElementById('token');
const said_el = document.getElementById('said');
token_el.focus();
form_el.addEventListener('submit', async function (event) {
    event.preventDefault();
    said_el.textContent = '';
    try {
        const answer = await fetch('/api/v1/session', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token: token_el.value.trim()})});
        if (answer.ok) {
            location.reload();
            return;
        }
        said_el.textContent = (await answer.json()).error;
    }
    catch (error) {
        said_el.textContent = error.message;
    }
});
`;

// What the control page answers a browser that brings no token, or one nobody holds
function render_sign_in_page(res)
{
    res.writeHead(401, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
    res.end(render_page({title: 'serviceman', body: BODY, script: SCRIPT}));
}

module.exports = render_sign_in_page;
