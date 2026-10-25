// What the page answers a browser that brings no token: a form that sends it once, for a
// cookie only this page's own requests carry
const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terminal</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: Canvas; color: CanvasText; font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; }
main { width: min(28rem, calc(100vw - 2rem)); padding: 1.5rem; border: 1px solid GrayText; border-radius: 12px; }
h1 { margin: 0 0 .35rem; font-size: 1.25rem; }
form { display: flex; gap: .5rem; margin-top: 1rem; }
input { flex: 1; min-width: 0; padding: .3rem .6rem; border: 1px solid GrayText; border-radius: 7px; background: Canvas; color: inherit; font: inherit; }
button { padding: .3rem .7rem; border: 1px solid GrayText; border-radius: 7px; background: Canvas; color: inherit; font: inherit; cursor: pointer; }
.error { color: #d03a2b; }
</style>
<main>
<h1>Terminal</h1>
<p>Paste the token to open a terminal here. It is <code>WEB_TERMINAL_TOKEN</code> where the terminal runs, or the one its log printed when it started.</p>
<form id="form"><input id="token" type="password" autocomplete="current-password" placeholder="wt_…" aria-label="The token" spellcheck="false"><button type="submit">Open</button></form>
<p id="said" class="error" role="alert"></p>
</main>
<script>
const form_el = document.getElementById('form');
const token_el = document.getElementById('token');
const said_el = document.getElementById('said');
token_el.focus();
form_el.addEventListener('submit', async function (event) {
    event.preventDefault();
    said_el.textContent = '';
    try {
        const answer = await fetch('/_/session', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token: token_el.value.trim()})});
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
</script>
`;

function sign_in_page()
{
    return PAGE;
}

module.exports = sign_in_page;
