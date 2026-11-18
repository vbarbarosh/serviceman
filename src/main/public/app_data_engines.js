// The databases an app's Data tab offers: each one's versions, newest first, the variable it fills
// unless renamed, and the address it is reached at on the app's machine
const app_data_engines = [
    {value: 'postgresql', label: 'PostgreSQL', versions: ['17', '16', '15'], env: 'DATABASE_URL', scheme: 'postgresql', port: 5432, adminer: true},
    {value: 'mysql', label: 'MySQL', versions: ['8.4', '8.0'], env: 'DATABASE_URL', scheme: 'mysql', port: 3306, adminer: true},
    {value: 'mariadb', label: 'MariaDB', versions: ['11.4', '10.11'], env: 'DATABASE_URL', scheme: 'mysql', port: 3306, adminer: true},
    {value: 'mongodb', label: 'MongoDB', versions: ['8.0', '7.0'], env: 'MONGO_URL', scheme: 'mongodb', port: 27017, adminer: false},
];

export default app_data_engines;
