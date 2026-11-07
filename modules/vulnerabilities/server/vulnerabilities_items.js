// The order of a machine's CVEs: what can be mended now, then what waits on Ubuntu
const ORDER = {fix_out: 0, restart: 1, pro: 2, no_fix: 3};

// A machine's CVEs as a page shows them, from what vulnerabilities_match found and what the host
// keeps of them: what each hits in a word or two, what mends it in a line, whether it is new,
// when it was found, and what Ubuntu's own page of it adds (its stopgap, the version a fix waits
// in). What can be mended comes first, the new before the rest, the newest CVE first.
//
//     matched   vulnerabilities_match's answer
//     kept      {codename, found: {cve: {at, fix_at}}, seen_at, notes: id => {mitigation,
//                pending} | null}: the host's; seen_at null where nothing is ever new
//     out       [{id, score, published, description, url, state, what, fix, new, found_at,
//                 fix_at, stopgap, pending}]
function vulnerabilities_items(matched, kept)
{
    const out = matched.map(function (item) {
        const when = kept.found[item.id] || {at: null, fix_at: null};
        const notes = kept.notes(item.id);
        const pending = pending_of(notes, kept.codename, item);
        return {
            id: item.id,
            score: item.score,
            published: item.published,
            description: item.description,
            url: item.url,
            state: item.state,
            what: what_of(item),
            fix: fix_of(item, pending),
            new: (kept.seen_at !== null) && (when.at !== null) && (when.at > kept.seen_at),
            found_at: when.at,
            fix_at: when.fix_at,
            stopgap: (notes === null) ? null : notes.mitigation,
            pending,
        };
    });
    out.sort((a, b) => (ORDER[a.state] - ORDER[b.state]) || ((b.new ? 1 : 0) - (a.new ? 1 : 0)) || (b.published || '').localeCompare(a.published || '') || a.id.localeCompare(b.id));
    return out;
}

// What it hits, in a word or two: the kernel, or the source packages it is in
function what_of(item)
{
    const names = [];
    for (const hit of item.hits) {
        const name = (hit.kind === 'kernel') ? 'kernel' : (hit.source || hit.name);
        if (names.includes(name) === false) {
            names.push(name);
        }
    }
    return names.join(', ');
}

// The version a fix waits in, as Ubuntu's page of the CVE says it for this release
function pending_of(notes, codename, item)
{
    if ((notes === null) || (item.state !== 'no_fix')) {
        return null;
    }
    const by_package = (notes.pending || {})[codename] || {};
    for (const hit of item.hits) {
        const name = (hit.kind === 'kernel') ? hit.flavour : (hit.source || hit.name);
        if (by_package[name] !== undefined) {
            return by_package[name];
        }
    }
    return null;
}

// What mends it, in a line
function fix_of(item, pending)
{
    const kernel = item.hits.find(v => v.kind === 'kernel');
    const fixed = item.hits.find(v => (v.kind === 'package') && (v.fixed !== null) && (/\+esm\d*/.test(v.fixed) === false));
    if (item.state === 'fix_out') {
        if (fixed !== undefined) {
            return `fixed in ${fixed.fixed}: install the updates (${fixed.name} has ${fixed.installed})`;
        }
        return `fixed in kernel ${kernel.fixed}: install the updates, then restart (${kernel.running} runs)`;
    }
    if (item.state === 'restart') {
        return `fixed in kernel ${kernel.fixed}, installed: restart the machine (${kernel.running} runs)`;
    }
    if (item.state === 'pro') {
        const pro = item.hits.find(v => v.fixed !== null);
        return `fixed only in Ubuntu Pro: ${pro.fixed}`;
    }
    return (pending === null) ? 'no fix yet' : `no fix yet: ${pending} is on its way`;
}

module.exports = vulnerabilities_items;
