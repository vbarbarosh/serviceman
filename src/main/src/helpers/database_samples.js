// The sample databases a server can be filled with, by engine: each file fetched once from where
// it is published, pinned to a commit or a release, and loaded only when its sha256 is the one
// pinned here: a file changed there is refused, never loaded unseen. Its files load in their
// order, as root; `database` is the one they make. PostgreSQL loads into a database it is
// connected to: `into` is made first and its files run there, or, null, they make their own.
const SAKILA = 'https://raw.githubusercontent.com/jOOQ/sakila/e089a5b1ec9af0df7a9c6a5d47d49fa1736a4e84';
const CHINOOK = 'https://github.com/lerocha/chinook-database/releases/download/v1.4.5';

const database_samples = {
    mysql: {
        sakila: {
            label: 'Sakila',
            about: 'a DVD rental shop, 16 tables and 47 thousand rows, from jOOQ on GitHub, BSD',
            database: 'sakila',
            files: [
                {url: `${SAKILA}/mysql-sakila-db/mysql-sakila-schema.sql`, sha256: 'f2c41c3bf6d6c239941b4f98fb37afad21f6be12b82bf586202529a793ccc2ee'},
                {url: `${SAKILA}/mysql-sakila-db/mysql-sakila-insert-data.sql`, sha256: '353ef858e4d2d1a60549969283434da15b905aef3ca7099d82b649b75f8de99f'},
            ],
        },
        chinook: {
            label: 'Chinook',
            about: 'a music store, 11 tables and 15 thousand rows, from GitHub, MIT',
            database: 'Chinook',
            files: [
                {url: `${CHINOOK}/Chinook_MySql.sql`, sha256: '02a1835417c3ea19bff64e1d1f22be738ce51b3f88b0473c24eebff9a3ccde4b'},
            ],
        },
    },
    postgresql: {
        sakila: {
            label: 'Sakila',
            about: 'a DVD rental shop, 21 tables and 47 thousand rows, from jOOQ on GitHub, BSD',
            database: 'sakila',
            into: 'sakila',
            files: [
                {url: `${SAKILA}/postgres-sakila-db/postgres-sakila-schema.sql`, sha256: 'eaa8cfc2fd358e70617d31ed3638196982944749929f02e90b980457855bfa48'},
                {url: `${SAKILA}/postgres-sakila-db/postgres-sakila-insert-data-using-copy.sql`, sha256: '072e793e9f4f2686b46de8904e1e5ca90c02cbc1873d69ed15401aef610ab52b'},
            ],
        },
        chinook: {
            label: 'Chinook',
            about: 'a music store, 11 tables and 15 thousand rows, from GitHub, MIT',
            database: 'chinook',
            into: null,
            files: [
                {url: `${CHINOOK}/Chinook_PostgreSql.sql`, sha256: 'e3fde5c1a5b51a2a91429a702c9ca6e69ba56e6c7f5e112724d70c3d03db695e'},
            ],
        },
    },
};

module.exports = database_samples;
