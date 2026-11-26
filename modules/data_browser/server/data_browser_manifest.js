// What the Data browser module holds and does, for its host to route, check and show: one
// database, its collections (a SQL database's tables), and a page of the documents (rows) of
// one of them, as a filter finds them. Read alone for now; no right a token may be given: the
// database's data is the owner's to see.
const data_browser_manifest = {
    module: 'data_browser',
    title: 'Data',
    kinds: [
        {
            kind: '',
            said: 'the database: its engine and its name',
            read: {},
            commands: [],
        },
        {
            kind: 'collections',
            said: 'a collection (a table): its name, its count, its size, its indexes',
            read: {},
            key: 'name',
            search: ['name'],
            sort: {key: 'name', down: false},
            columns: [
                {key: 'name', label: 'Name', as: 'code', sort: true},
                {key: 'count', label: 'Documents', as: 'count', fold: 3, sort: true},
                {key: 'bytes', label: 'Size', as: 'bytes', fold: 2, sort: true},
                {key: 'indexes', label: 'Indexes', as: 'count', fold: 1, muted: true},
            ],
            commands: [],
        },
        {
            kind: 'documents',
            said: 'a page of one collection\'s documents: ?collection, filter, sort, fields, skip, limit',
            read: {},
            commands: [],
        },
    ],
    doors: [],
};

module.exports = data_browser_manifest;
