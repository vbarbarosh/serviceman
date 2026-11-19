// The SQL that makes a database's own user, with every right on that database and none on any
// other: {user, password} as made by database_user_make. Names are quoted for MySQL, the
// password is a literal; neither can hold a quote, by how they are made.
function database_user_sql(database, user)
{
    return [
        `CREATE DATABASE IF NOT EXISTS \`${database}\`;`,
        `CREATE USER IF NOT EXISTS '${user.user}'@'%' IDENTIFIED BY '${user.password}';`,
        `ALTER USER '${user.user}'@'%' IDENTIFIED BY '${user.password}';`,
        `GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${user.user}'@'%';`,
        '',
    ].join('\n');
}

module.exports = database_user_sql;
