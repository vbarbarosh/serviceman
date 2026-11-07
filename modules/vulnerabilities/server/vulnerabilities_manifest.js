// What the Vulnerabilities module holds, for its host to route, check and show: one kind, the
// critical CVEs that hit the machine, read and nothing else. Its columns are how a page draws
// them (items_view): the CVE never folded, what mends it next, when it was found last to fold.
const vulnerabilities_manifest = {
    module: 'vulnerabilities',
    title: 'Vulnerabilities',
    kinds: [
        {
            kind: '',
            said: 'a critical CVE that hits the machine: what it hits, its score, whether a fix is out, and whether it is new',
            id: 'CVE-[0-9]{4}-[0-9]+',
            example: 'CVE-2026-98432',
            read: {right: {right: 'vulnerabilities', said: 'read the CVEs that hit it'}},
            key: 'id',
            search: ['id', 'what', 'fix', 'description'],
            columns: [
                {key: 'id', label: 'CVE', as: 'code'},
                {key: 'score', label: 'Score', as: 'text', fold: 3, align: 'right', sort: true},
                {key: 'what', label: 'Hits', fold: 4, sort: true},
                {key: 'fix', label: 'Fix', wraps: true},
                {key: 'published', label: 'Published', fold: 2, muted: true, sort: true},
                {key: 'found_at', label: 'Found', as: 'ago', fold: 1, sort: true, none: '—'},
            ],
            commands: [],
        },
    ],
    doors: [],
};

module.exports = vulnerabilities_manifest;
