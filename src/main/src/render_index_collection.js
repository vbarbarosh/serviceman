const service_phase = require('./helpers/service_phase');

// The design the collection names, for whatever draws it
const DESIGN = 'github';
const TITLE = 'serviceman';

// What the pool is doing right now, said in one character at the end of the name. A design draws
// the label and nothing else, so this is the only place a state can be seen on the page.
const PHASE_MARK = {
    running: '🟢',
    starting: '🟡',
    stopping: '🟠',
    failed: '🔴',
    stopped: '⚪',
    // Somebody else's machine is out of reach: unknown, which is not the same as stopped
    lost: '❔',
};

// Everything that answers on this host, as a NavPlace collection — the plain-text format its
// parser reads: `% key: value` at the top, `# Section` above a group, and one line per link with
// the address last.
//
// serviceman knows what is here; NavPlace knows how to find things in a list. This is the seam
// between the two, and it is the same text whether it is read by the desktop app through
// `collection_url` or by an embed on somebody's own site.
function render_index_collection(app, port)
{
    const lines = [`% design: ${DESIGN}`, `% title: ${TITLE}`, ''];
    const kinds = [];
    for (const item of app.services) {
        if ((item.hosts.length === 0) || kinds.includes(item.type)) {
            continue;
        }
        kinds.push(item.type);
    }
    for (const kind of kinds) {
        lines.push(`# ${kind}`);
        for (const item of app.services) {
            if (item.type !== kind) {
                continue;
            }
            for (const host of item.hosts) {
                lines.push(line_of(item, host, port));
            }
        }
        lines.push('');
    }
    return lines.join('\n');
}

// `label #tag  http://address` — the address is always last, which is how the parser finds it
function line_of(service, host, port)
{
    const name = (service.title || service.name).replace(/\s+/g, ' ').trim();
    // The name is worth a tag only when the label does not already say it — asked of the name
    // itself, because the mark is on the end of every label
    const tags = [service.name, service.type].filter(v => tag_of(v) !== tag_of(name));
    const label = `${name} ${PHASE_MARK[service_phase(service)]}`;
    return `${label} ${tags.map(v => `#${tag_of(v)}`).join(' ')}  ${address_of(host, port)}`;
}

// A tag is one word of letters, digits, - and _; anything else in a name is dropped rather than
// breaking the line it sits on
function tag_of(text)
{
    return text.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function address_of(host, port)
{
    const mark = host.indexOf('/');
    const name = ((mark === -1) ? host : host.slice(0, mark));
    const path = ((mark === -1) ? '' : host.slice(mark));
    return `http://${name}${(port === '') ? '' : `:${port}`}${path}`;
}

module.exports = render_index_collection;
