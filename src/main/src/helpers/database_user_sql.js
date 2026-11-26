// The SQL that makes a database's own user, with every right on that database and none on any
// other: {user, password} as made by database_user_make, whose names and password no SQL needs to
// quote. MySQL makes the database too when it is not there. PostgreSQL gives the user what is in
// it, a sample's tables loaded as root: `made` makes the database first, owned by the user, for
// one that is not there; it runs in postgres, and moves into the database for the grants.
// MongoDB's is a mongosh script: the user is made in its database, which signs it in, as the
// owner of that database alone; MongoDB makes the database itself at its first write.
function database_user_sql(engine, database, user, made)
{
    if (engine === 'mongodb') {
        return [
            `const roles = [{role: 'dbOwner', db: '${database}'}];`,
            `if (db.getSiblingDB('${database}').getUser('${user.user}') === null) {`,
            `    db.getSiblingDB('${database}').createUser({user: '${user.user}', pwd: '${user.password}', roles});`,
            '}',
            'else {',
            `    db.getSiblingDB('${database}').updateUser('${user.user}', {pwd: '${user.password}', roles});`,
            '}',
            '',
        ].join('\n');
    }
    if (engine === 'postgresql') {
        return [
            `DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = '${user.user}') THEN ALTER ROLE "${user.user}" WITH LOGIN PASSWORD '${user.password}'; ELSE CREATE ROLE "${user.user}" WITH LOGIN PASSWORD '${user.password}'; END IF; END $$;`,
            made ? `CREATE DATABASE "${database}" OWNER "${user.user}";` : `ALTER DATABASE "${database}" OWNER TO "${user.user}";`,
            // Every user may connect to every database unless told otherwise: here, its owner alone
            `REVOKE ALL ON DATABASE "${database}" FROM PUBLIC;`,
            `\\connect "${database}"`,
            `GRANT ALL ON SCHEMA public TO "${user.user}";`,
            `GRANT ALL ON ALL TABLES IN SCHEMA public TO "${user.user}";`,
            `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${user.user}";`,
            '',
        ].join('\n');
    }
    return [
        `CREATE DATABASE IF NOT EXISTS \`${database}\`;`,
        `CREATE USER IF NOT EXISTS '${user.user}'@'%' IDENTIFIED BY '${user.password}';`,
        `ALTER USER '${user.user}'@'%' IDENTIFIED BY '${user.password}';`,
        `GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${user.user}'@'%';`,
        '',
    ].join('\n');
}

module.exports = database_user_sql;
