import app_data_env_free from './app_data_env_free.js';

// A database given to an app the way its Data tab gives one: the app's entry read from the
// config, {server, database, env} added to its databases, the service written back; it finds it
// from its next start. `env` is the name wanted; the first free one of it is taken, so a second
// database beside a DATABASE_URL is DATABASE_URL_2. Answers the variable it finds it in; throws
// what serviceman said when it refused.
//
//     await app_database_give('shop', 'mongodb-1', 'orders', 'MONGODB_URL')   // 'MONGODB_URL'
async function app_database_give(app, server, database, env)
{
    const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
    const entry = (JSON.parse(loaded.text).services || []).find(v => v.name === app);
    if (entry === undefined) {
        throw new Error(`${app} is not in the config any more`);
    }
    const rows = (entry.databases || []).concat(entry.folders || []);
    const out = app_data_env_free(rows.map(v => v.env), env);
    const service = Object.assign({}, entry, {databases: (entry.databases || []).concat([{server, database, env: out}])});
    const answer = await fetch(`/api/v1/services/${encodeURIComponent(app)}`, {method: 'PUT', body: JSON.stringify({service})});
    if (answer.ok === false) {
        throw new Error((await answer.json().catch(() => ({}))).error || `serviceman answered ${answer.status}`);
    }
    return out;
}

export default app_database_give;
