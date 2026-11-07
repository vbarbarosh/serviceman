const fs = require('fs');
const path = require('path');

// How long Ubuntu's word on a CVE is kept before it is asked again, and how soon after it did
// not answer (its CVE pages answer 503 now and then)
const FRESH_MS = 24*60*60*1000;
const RETRY_MS = 60*60*1000;
const TIMEOUT_MS = 30*1000;
// How many of its pages are asked at once
const AT_ONCE = 2;

// What Ubuntu's own page of a CVE adds to its file, for the CVEs with no fix out that hit a
// machine: the stopgap Ubuntu gives until the fix (its mitigation), and the version a fix is
// pending in for each release. Asked in the background, a few at a time, kept in the state
// folder; a CVE whose page did not answer is shown without them.
//
//     vulnerabilities_notes(app, id)         -> {at, error, mitigation, pending: {codename: {package: version}}} or null
//     vulnerabilities_notes.wanted(app, codename, ids)
function vulnerabilities_notes(app, id)
{
    const kept = kept_of(app).items[id];
    return (kept === undefined) ? null : kept;
}

vulnerabilities_notes.wanted = function (app, codename, ids) {
    const state = kept_of(app);
    const now = Date.now();
    for (const id of ids) {
        const kept = state.items[id];
        const wait = ((kept === undefined) || (kept.error === null)) ? FRESH_MS : RETRY_MS;
        if (((kept === undefined) || (now - kept.at >= wait)) && (state.queue.includes(id) === false) && (/^CVE-\d{4}-\d+$/.test(id))) {
            state.queue.push(id);
        }
    }
    pump(app);
};

vulnerabilities_notes.url_of = url_of;

// Ubuntu's page of one CVE, as JSON
function url_of(id)
{
    return `https://ubuntu.com/security/cves/${id}.json`;
}

function kept_of(app)
{
    if (app.vulnerability_notes === undefined) {
        let items = {};
        try {
            items = JSON.parse(fs.readFileSync(file_of(app), 'utf8'));
        }
        catch {
            items = {};
        }
        app.vulnerability_notes = {items, queue: [], running: 0};
    }
    return app.vulnerability_notes;
}

function file_of(app)
{
    return path.resolve(app.state_dir, 'vulnerabilities', 'notes.json');
}

function pump(app)
{
    const state = kept_of(app);
    while ((state.running < AT_ONCE) && (state.queue.length > 0)) {
        const id = state.queue.shift();
        state.running++;
        ask(app, id).finally(function () {
            state.running--;
            pump(app);
        });
    }
}

async function ask(app, id)
{
    const state = kept_of(app);
    const note = {at: Date.now(), error: null, mitigation: null, pending: {}};
    try {
        const answer = await (app.vulnerabilities_fetch || fetch)(url_of(id), {signal: AbortSignal.timeout(TIMEOUT_MS)});
        if (answer.ok === false) {
            throw new Error(`${url_of(id)} answered ${answer.status}`);
        }
        const cve = await answer.json();
        note.mitigation = mitigation_of(cve.mitigation);
        for (const item of (Array.isArray(cve.packages) ? cve.packages : [])) {
            for (const status of (Array.isArray(item.statuses) ? item.statuses : [])) {
                if ((status.status === 'pending') && (typeof status.description === 'string') && (status.description.trim() !== '')) {
                    note.pending[status.release_codename] = note.pending[status.release_codename] || {};
                    note.pending[status.release_codename][item.name] = status.description.trim();
                }
            }
        }
    }
    catch (error) {
        note.error = error.message;
        // A page that answered once keeps what it said until it answers again
        const was = state.items[id];
        if (was !== undefined) {
            note.mitigation = was.mitigation;
            note.pending = was.pending;
        }
    }
    state.items[id] = note;
    fs.mkdirSync(path.dirname(file_of(app)), {recursive: true});
    fs.writeFileSync(`${file_of(app)}.tmp`, JSON.stringify(state.items));
    fs.renameSync(`${file_of(app)}.tmp`, file_of(app));
}

// Ubuntu's tracker writes its notes as "name> text": the text alone, a few KB at most
function mitigation_of(text)
{
    if ((typeof text !== 'string') || (text.trim() === '')) {
        return null;
    }
    const said = text.trim().replace(/^[\w.-]+>\s*/, '');
    return (said.length > 4000) ? `${said.slice(0, 4000)}…` : said;
}

module.exports = vulnerabilities_notes;
