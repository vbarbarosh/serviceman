// The variable an app is given a database in until another name is typed, by its server's
// engine: a CouchDB's admin and a MongoDB's database apart from a SQL one's
const ENVS = {couchdb: 'COUCHDB_URL', mongodb: 'MONGODB_URL'};

function database_env_given(engine)
{
    return ENVS[engine] || 'DATABASE_URL';
}

export default database_env_given;
