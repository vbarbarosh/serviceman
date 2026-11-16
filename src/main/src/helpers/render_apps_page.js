const app_files_put = require('./app_files_put');
const html_escape = require('./html_escape');
const page_tokens = require('./page_tokens');
const service_is_app = require('./service_is_app');
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
.cell.off, .cell.off:hover {
    border-color: var(--line);
    background: var(--panel);
    opacity: .6;
}
.cell.off .tile {
    background: hsl(var(--hue) 10% 36%);
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

// A Host and its port: apps.example.com:3000, [fd7a:115c:a1e0::15]:3000
const RE_HOST_PORT = /^(.*?)(:[0-9]+)?$/;

// What a cell says of its app's state, in a visitor's words
const STATE_WORDS = {running: 'running', starting: 'starting', stopping: 'stopping', failed: 'failed', lost: 'its machine went', stopped: 'asleep'};

// A page of apps (apps_page_of): a cell for each, by name, with its state, opening it the way the
// browser that asked reaches it.
//
//     domain   at the apps domain itself: every service whose own address is under it, an app
//              sent to serviceman or anything else published there, on the port the page was
//              asked on, so the page works on serviceman's own door as behind a machine's
//     here     at apps.localhost: every app, at its name on this computer, on the page's port
//     tailnet  at serviceman's tailnet name: every app, at its own port on the name typed; one
//              whose port does not listen is a cell that says so and opens nothing
//
//     page     {way, domain}, as apps_page_of gives it
//     asked    the Host the visitor asked with, its port too: apps.example.com:3000
function render_apps_page(app, page, asked)
{
    const [, name_asked, port = ''] = RE_HOST_PORT.exec(String(asked || ''));
    const cells = cells_of(app, page, name_asked, port);
    cells.sort((a, b) => a.title.localeCompare(b.title));
    const items = cells.map(function (cell) {
        const phase = service_phase(cell.service);
        const tile = `<span class="tile" style="--hue: ${hue_of(cell.service.name)}">${html_escape(Array.from(cell.title)[0].toUpperCase())}</span><b>${html_escape(cell.title)}</b>`;
        if (cell.href === null) {
            return `<li><div class="cell off" title="${html_escape(cell.title)} · ${html_escape(cell.why)}">${tile}<span class="host">${html_escape(cell.address)}</span><span class="state"><i class="dot"></i>${html_escape(cell.why)}</span></div></li>`;
        }
        return `<li><a class="cell" href="${html_escape(cell.href)}" title="${html_escape(cell.title)} · ${html_escape(cell.href.slice(2))}">${tile}<span class="host">${html_escape(cell.address)}</span><span class="state"><i class="dot ${html_escape(phase)}"></i>${html_escape(STATE_WORDS[phase] || phase)}</span></a></li>`;
    });
    const none = (page.way === 'domain') ? `No app here yet: one sent to serviceman under ${html_escape(page.domain)} lands here.` : 'No app here yet: one dropped on serviceman\'s Apps page lands here.';
    const list = (items.length === 0) ? `<p class="none">${none}</p>` : `<ul class="cells">${items.join('')}</ul>`;
    const apps = `${cells.length} ${(cells.length === 1) ? 'app' : 'apps'}`;
    const where = {domain: `under ${html_escape(page.domain)}`, here: 'on this computer', tailnet: 'on every device of your tailnet'}[page.way];
    const theme = theme_switch();
    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Apps</title>
<style>${PAGE_CSS}</style>
<script>${theme.stamp}</script>
<header><h1>Apps</h1><p>${apps} ${where}</p></header>
${list}
${theme.button}
<script>${theme.toggle}</script>
`;
}

// The cells of a page: {service, title, address, href, why}, href null for one that opens
// nothing from here, why then saying so
function cells_of(app, page, name_asked, port)
{
    const out = [];
    for (const service of app.services) {
        const hosts = service.hosts.filter(v => (v.startsWith('*') === false));
        const title = service.title || service.name;
        if (page.way === 'domain') {
            const host = hosts.map(v => v.split('/')[0]).find(v => v.endsWith(`.${page.domain}`));
            if (host !== undefined) {
                out.push({service, title, address: host, href: `//${host}${port}/`, why: ''});
            }
            continue;
        }
        if ((service_is_app(service) === false) || (hosts.length === 0)) {
            continue;
        }
        if (page.way === 'here') {
            const here = app_files_put.hosts(app, service.name);
            const local = here[here.length - 1];
            const suffix = local.slice(local.indexOf('.'));
            const host = hosts.find(v => v.split('/')[0].endsWith(suffix)) || hosts[0];
            out.push({service, title, address: host, href: `//${host.split('/')[0]}${port}${path_of(host)}`, why: ''});
            continue;
        }
        const own = app.app_ports_here[service.name];
        if ((own === undefined) || (own.error !== null)) {
            // As Apps says it: another program holds it, or it closed
            const why = (own === undefined) ? 'no port of its own' : (/EADDRINUSE/.test(own.error) ? 'its port is taken' : 'its port is closed');
            out.push({service, title, address: (own === undefined) ? 'no port' : `port ${own.port}`, href: null, why});
            continue;
        }
        // The name is the same on every cell, and long: the port is what tells them apart. A port
        // that answers https is opened so, under the name on its certificate.
        const held = app.tailnet_cert;
        const href = (held.context === null) ? `//${name_asked}:${own.port}/` : `https://${held.domain}:${own.port}/`;
        out.push({service, title, address: `port ${own.port}`, href, why: ''});
    }
    return out;
}

// The path a host of a service names, tools.example.com/pdf: /pdf, and / for none
function path_of(host)
{
    const at = host.indexOf('/');
    return (at === -1) ? '/' : host.slice(at);
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
