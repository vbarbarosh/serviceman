const agent_door_proxy = require('./agent_door_proxy');
const agent_http_error = require('./agent_http_error');
const agent_say = require('./agent_say');
const crypto = require('crypto');
const http = require('http');

// Where a store for each user answers on an app's own address
const COUCH_PATH = '/_couch';
// A path that steps out of the user's own database, written plainly or percent-encoded
const RE_STEP_OUT = /(^|\/)(\.|%2e){1,2}(\/|$)/i;
// Whatever a visitor could name themselves with to CouchDB: taken out before the name is signed
const CLAIMS = ['authorization', 'cookie', 'x-forwarded-user', 'x-forwarded-user-token', 'x-forwarded-roles'];
// A CouchDB that does not answer in this is a CouchDB that is not answering
const ASK_MS = 10000;

// The databases made since this agent started, by the port of their CouchDB and their name
const made = new Set();

// A store for each user: /_couch on an app's own address, answered by the agent at the door of
// the machine its CouchDB runs on, once the wall in front of the app said who the visitor is.
// The user's own database is made the first time, with that user alone as its member, and the
// request goes on to CouchDB on 127.0.0.1 with the name signed by the secret CouchDB trusts, at
// that database alone: /_couch/notes-1 is /userdb-<hex of the name>/notes-1. serviceman is in
// none of it; it only wrote the door's table.
//
// couch  {port, secret, admin: {user, password}}, as the table names it for the app's name
// user   the name the wall said
async function agent_couch_answer(req, res, couch, user, group)
{
    if (user === '') {
        agent_say(group, 'door_request_refused', {status: 403, why: 'the wall let the visitor in and named nobody, so there is no store to give'});
        agent_http_error(res, 403);
        return;
    }
    const rest = req.url.slice(COUCH_PATH.length);
    if (RE_STEP_OUT.test(rest.split('?')[0])) {
        agent_say(group, 'door_request_refused', {status: 400, why: 'a path out of the user\'s own database'});
        agent_http_error(res, 400);
        return;
    }
    const database = database_of(user);
    try {
        await made_once(couch, database, user, group);
    }
    catch (error) {
        agent_say(group, 'door_couch_error', {database, reason: error.message});
        agent_http_error(res, 502);
        return;
    }
    claims_drop(req);
    req.url = `/${database}${rest}`;
    const token = crypto.createHmac('sha256', couch.secret).update(user, 'utf8').digest('hex');
    await agent_door_proxy(req, res, {host: '127.0.0.1', port: couch.port}, {'x-forwarded-user': user, 'x-forwarded-user-token': token});
}

// Whether this path is the store's: /_couch itself, or anything under it
agent_couch_answer.asks = function (url) {
    const path = url.split('?')[0];
    return (path === COUCH_PATH) || path.startsWith(`${COUCH_PATH}/`);
};

// The user's database, named as CouchDB's own couch_peruser names it: userdb- and the name's
// bytes in hex, which any name fits and no two names share
function database_of(user)
{
    return `userdb-${Buffer.from(user, 'utf8').toString('hex')}`;
}

// The database made, and given to that user alone, the first time the user comes; one that is
// there already is kept as it is
async function made_once(couch, database, user, group)
{
    const key = `${couch.port}/${database}`;
    if (made.has(key)) {
        return;
    }
    const created = await couch_ask(couch, 'PUT', `/${database}`, null);
    if ((created !== 201) && (created !== 202) && (created !== 412)) {
        throw new Error(`making ${database} was answered ${created}`);
    }
    const security = {admins: {names: [], roles: []}, members: {names: [user], roles: []}};
    const given = await couch_ask(couch, 'PUT', `/${database}/_security`, security);
    if (given !== 200) {
        throw new Error(`giving ${database} to its user was answered ${given}`);
    }
    made.add(key);
    if (created !== 412) {
        agent_say(group, 'door_couch_made', {database});
    }
}

// One request of the CouchDB's admin: the status it was answered
function couch_ask(couch, method, path, body)
{
    return new Promise(function (resolve, reject) {
        const text = (body === null) ? '' : JSON.stringify(body);
        const auth = Buffer.from(`${couch.admin.user}:${couch.admin.password}`).toString('base64');
        const headers = {'authorization': `Basic ${auth}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(text)};
        const asking = http.request({host: '127.0.0.1', port: couch.port, method, path, headers, agent: false, timeout: ASK_MS}, function (answer) {
            answer.resume();
            answer.on('end', () => resolve(answer.statusCode));
        });
        asking.on('timeout', () => asking.destroy(new Error(`no answer in ${ASK_MS/1000}s`)));
        asking.on('error', reject);
        asking.end(text);
    });
}

// The visitor's own word on who they are to CouchDB, `_` read as `-` as some stacks read it
function claims_drop(req)
{
    for (const name of Object.keys(req.headers)) {
        if (CLAIMS.includes(name.replace(/_/g, '-'))) {
            delete req.headers[name];
        }
    }
}

module.exports = agent_couch_answer;
