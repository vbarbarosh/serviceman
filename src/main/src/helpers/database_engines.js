// The database servers serviceman brings up, each in the official image of its version: the
// port it listens on inside, where it keeps its data and the scheme of its DATABASE_URL; the
// samples it can be filled with are in database_samples, under its value
const database_engines = [
    {
        value: 'mysql',
        label: 'MySQL',
        versions: {'8.4': 'docker.io/library/mysql:8.4', '8.0': 'docker.io/library/mysql:8.0'},
        port: 3306,
        data: '/var/lib/mysql',
        scheme: 'mysql',
    },
];

module.exports = database_engines;
