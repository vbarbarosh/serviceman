// What the Data browser module holds and does, for its host to route, check and show: one
// database, its collections (a SQL database's tables), a page of the documents (rows) of one of
// them, as a filter or a pipeline finds them, a SQL row read whole by its key, and a document
// (a row) added, put in place of another or deleted. No right a token may be given: the
// database's data is the owner's.
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
            commands: [
                {command: 'create', on: 'kind', said: 'add a document, typed as the shell types it', body: ['collection', 'document']},
                {command: 'replace', on: 'kind', said: 'put a document in place of the one of its _id; a SQL row\'s columns changed since `was`, by its key', body: ['collection', 'id', 'document', 'was']},
                {command: 'delete', on: 'kind', said: 'delete the document of an _id', body: ['collection', 'id'], danger: true},
            ],
        },
        {
            kind: 'document',
            said: 'one SQL row read whole by its key, with its table\'s columns: ?collection, id',
            read: {},
            commands: [],
        },
        {
            kind: 'aggregate',
            said: 'a page of what a pipeline makes of one collection: ?collection, pipeline, skip, limit',
            read: {},
            commands: [],
        },
    ],
    doors: [],
};

module.exports = data_browser_manifest;
