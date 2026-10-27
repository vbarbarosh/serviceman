// The columns of distro-info's lists that say when a release stops getting its updates, the
// first one filled in holding: for Ubuntu the server's end where the list has one, then the
// end of its standard support, and Ubuntu Pro's (ESM) after it; for Debian its security team's
// end, and the LTS team's after it
const COLUMNS = {
    ubuntu: {eol: ['eol-server', 'eol'], eol_extended: ['eol-esm']},
    debian: {eol: ['eol'], eol_extended: ['eol-lts']},
};
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

// When the release `codename` of `id` stops getting updates, from the list distro-info keeps
// for it (/usr/share/distro-info/<id>.csv): by the names in its header, so a column added to
// the list later moves nothing. A release the list does not have, or one with no end yet
// (Debian's testing, an Ubuntu still in its first months), says null.
//
//     -> {eol, eol_extended}, each 'YYYY-MM-DD' or null
function distro_eol_from_csv(id, codename, text)
{
    const out = {eol: null, eol_extended: null};
    const columns = COLUMNS[id];
    if ((columns === undefined) || (codename === null)) {
        return out;
    }
    const lines = text.split('\n').map(v => v.trim()).filter(v => v !== '');
    if (lines.length === 0) {
        return out;
    }
    const head = lines[0].split(',');
    const series = head.indexOf('series');
    const row = lines.slice(1).map(v => v.split(',')).find(v => v[series] === codename);
    if ((series === -1) || (row === undefined)) {
        return out;
    }
    for (const key of Object.keys(columns)) {
        const value = columns[key].map(v => row[head.indexOf(v)]).find(v => RE_DATE.test(v || ''));
        out[key] = (value === undefined) ? null : value;
    }
    return out;
}

module.exports = distro_eol_from_csv;
