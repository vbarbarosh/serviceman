// The database servers serviceman brings up, each in the official image of its version: the
// port it listens on inside, where it keeps its data, the scheme of its DATABASE_URL, the
// variable its image takes root's password in, and the one its client reads a password from.
// The samples it can be filled with are in database_samples, under its value. CouchDB has no
// client and no user per database: an app is given it as its admin, named in `admin`, which
// its image takes in `admin_env`, with the secret it trusts a signed user name by. MongoDB's
// image takes root's name too, `root_user` in `root_user_env`; its client, mongosh, reads no
// password from its env, so serviceman's script reads root's from `password_env` itself.
const database_engines = [
    {
        value: 'mysql',
        label: 'MySQL',
        versions: {'8.4': 'docker.io/library/mysql:8.4', '8.0': 'docker.io/library/mysql:8.0'},
        port: 3306,
        data: '/var/lib/mysql',
        scheme: 'mysql',
        root_env: 'MYSQL_ROOT_PASSWORD',
        password_env: 'MYSQL_PWD',
    },
    {
        value: 'postgresql',
        label: 'PostgreSQL',
        versions: {'17': 'docker.io/library/postgres:17', '16': 'docker.io/library/postgres:16'},
        port: 5432,
        data: '/var/lib/postgresql/data',
        scheme: 'postgresql',
        root_env: 'POSTGRES_PASSWORD',
        password_env: 'PGPASSWORD',
    },
    {
        value: 'couchdb',
        label: 'CouchDB',
        versions: {'3': 'docker.io/library/couchdb:3'},
        port: 5984,
        data: '/opt/couchdb/data',
        scheme: 'http',
        root_env: 'COUCHDB_PASSWORD',
        password_env: null,
        admin: 'admin',
        admin_env: 'COUCHDB_USER',
    },
    {
        value: 'mongodb',
        label: 'MongoDB',
        versions: {'8.0': 'docker.io/library/mongo:8.0', '7.0': 'docker.io/library/mongo:7.0'},
        port: 27017,
        data: '/data/db',
        scheme: 'mongodb',
        root_env: 'MONGO_INITDB_ROOT_PASSWORD',
        password_env: 'MONGO_ROOT_PASSWORD',
        root_user: 'root',
        root_user_env: 'MONGO_INITDB_ROOT_USERNAME',
    },
];

module.exports = database_engines;
