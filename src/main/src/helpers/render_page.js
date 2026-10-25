const html_escape = require('./html_escape');
const page_tokens = require('./page_tokens');
const theme_switch = require('./theme_switch');

const PAGE_CSS = `
${page_tokens()}
* {
    box-sizing: border-box;
}
body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    color: var(--fg);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
main {
    width: min(34rem, calc(100vw - 2rem));
    padding: 1.75rem;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--panel);
}
h1 {
    margin: 0 0 .35rem;
    font-size: 1.25rem;
}
p {
    margin: .35rem 0;
    color: var(--muted);
}
code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .875em;
}
button {
    padding: .3rem .7rem;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--panel);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
    transition: background .12s ease, border-color .12s ease, color .12s ease;
}
button:hover {
    background: var(--hover);
    border-color: var(--accent);
}
#theme {
    position: fixed;
    top: 1rem;
    right: 1rem;
    display: flex;
    padding: .35rem;
    color: var(--muted);
}
#said {
    max-height: 14rem;
    margin: 1rem 0 0;
    padding: .75rem 1rem;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-y: auto;
    overflow-wrap: anywhere;
}
.bar {
    height: 4px;
    margin: 1.15rem 0 .35rem;
    border-radius: 4px;
    background: var(--line);
    overflow: hidden;
}
.bar i {
    display: block;
    width: 35%;
    height: 100%;
    border-radius: 4px;
    background: var(--accent);
    animation: slide 1.4s ease-in-out infinite;
}
/* A download says how far it is, so the bar shows that instead of sliding to look busy */
.bar.known i {
    animation: none;
    transition: width .3s ease;
}
@keyframes slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(340%); }
}
/* The numbers behind the sentence above them: quieter than it, and never wider than the box */
.numbers {
    margin: -.5rem 0 .35rem;
    color: var(--muted);
    font-size: 14px;
}
.error {
    color: var(--bad);
    white-space: pre-wrap;
    word-break: break-word;
}
`;

// Every page serviceman serves itself: one card, light and dark, and the switch between them
function render_page(page)
{
    const theme = theme_switch();
    const script = page.script ? `<script>${page.script}</script>` : '';
    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html_escape(page.title)}</title>
<style>${PAGE_CSS}</style>
<script>${theme.stamp}</script>
<main>${page.body}</main>
${theme.button}
<script>${theme.toggle}</script>
${script}
`;
}

module.exports = render_page;
