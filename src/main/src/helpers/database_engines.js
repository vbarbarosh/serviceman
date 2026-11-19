// The database servers serviceman brings up, each in the official image of its version: the
// port it listens on inside, where it keeps its data, the scheme of its DATABASE_URL, the
// variable its image takes root's password in, and the one its client reads a password from.
// The samples it can be filled with are in database_samples, under its value.
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
];

module.exports = database_engines;
