const html_escape = require('./html_escape');
const page_tokens = require('./page_tokens');
const service_phase = require('./service_phase');
const theme_switch = require('./theme_switch');

const PAGE_CSS = `
${page_tokens()}
* {
    box-sizing: border-box;
}
body {
    margin: 0;
    padding: 2rem max(1rem, calc((100vw - 64rem)/2));
    background: var(--bg);
    color: var(--fg);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
h1 {
    margin: 0;
    font-size: 1.4rem;
}
header p, .none {
    margin: .25rem 0 1.25rem;
    color: var(--muted);
}
.cells {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: .9rem;
    margin: 0;
    padding: 0;
    list-style: none;
}
.cell {
    display: flex;
    flex-direction: column;
    gap: .2rem;
    height: 100%;
    padding: .8rem;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--panel);
    color: inherit;
    text-decoration: none;
    transition: border-color .12s ease, background .12s ease;
}
.cell:hover {
    border-color: var(--accent);
    background: var(--hover);
}
.tile {
    display: grid;
    place-items: center;
    height: 5.5rem;
    margin-bottom: .45rem;
    border-radius: 8px;
    background: hsl(var(--hue) 40% 36%);
    color: #fff;
    font-size: 2rem;
    font-weight: 700;
}
.cell b, .host {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.host, .state {
    color: var(--muted);
    font-size: 13px;
}
.dot {
    display: inline-block;
    width: .55rem;
    height: .55rem;
    margin-right: .35rem;
    border-radius: 50%;
    background: var(--idle);
}
.dot.running {
    background: var(--run);
}
.dot.starting {
    background: var(--busy);
}
.dot.failed {
    background: var(--bad);
}
#theme {
    position: fixed;
    top: 1rem;
    right: 1rem;
    display: flex;
    padding: .35rem;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--panel);
    color: var(--muted);
    cursor: pointer;
}
`;

// What a cell says of its app's state, in a visitor's words
const STATE_WORDS = {running: 'running', starting: 'starting', stopping: 'stopping', failed: 'failed', lost: 'its machine went', stopped: 'asleep'};

// The page of cells at the apps domain itself: every service whose own address is under it, an
// app sent to serviceman or anything else published there, each a cell that opens it, with its
// state. The addresses keep the port the visitor came in on, so the page works on serviceman's
// own door as behind a machine's.
//
//     domain  apps.example.com
//     asked   the Host the visitor asked with, its port too: apps.example.com:3000
function render_apps_page(app, domain, asked)
{
    const at = String(asked || '').indexOf(':');
    const port = (at === -1) ? '' : String(asked).slice(at);
    const cells = [];
    for (const service of app.services) {
        const host = service.hosts.map(v => v.split('/')[0]).find(v => v.endsWith(`.${domain}`) && (v.startsWith('*') === false));
        if (host === undefined) {
            continue;
        }
        cells.push({service, host, title: service.title || service.name});
    }
    cells.sort((a, b) => a.title.localeCompare(b.title));
    const items = cells.map(function (cell) {
        const phase = service_phase(cell.service);
        return `<li><a class="cell" href="//${html_escape(cell.host)}${html_escape(port)}/" title="${html_escape(cell.title)} · ${html_escape(cell.host)}"><span class="tile" style="--hue: ${hue_of(cell.service.name)}">${html_escape(Array.from(cell.title)[0].toUpperCase())}</span><b>${html_escape(cell.title)}</b><span class="host">${html_escape(cell.host)}</span><span class="state"><i class="dot ${html_escape(phase)}"></i>${html_escape(STATE_WORDS[phase] || phase)}</span></a></li>`;
    });
    const list = (items.length === 0) ? `<p class="none">No app here yet: one sent to serviceman under ${html_escape(domain)} lands here.</p>` : `<ul class="cells">${items.join('')}</ul>`;
    const count = `${cells.length} ${(cells.length === 1) ? 'app' : 'apps'} under ${html_escape(domain)}`;
    const theme = theme_switch();
    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Apps</title>
<style>${PAGE_CSS}</style>
<script>${theme.stamp}</script>
<header><h1>Apps</h1><p>${count}</p></header>
${list}
${theme.button}
<script>${theme.toggle}</script>
`;
}

// Each app its own colour, the same on every visit
function hue_of(name)
{
    let out = 0;
    for (const char of name) {
        out = ((out*31) + char.codePointAt(0)) % 360;
    }
    return out;
}

module.exports = render_apps_page;
