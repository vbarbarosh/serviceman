const body_read = require('../body_read');
const control_caller = require('../helpers/control_caller');
const control_route_right = require('../helpers/control_route_right');
const control_token_hash = require('../helpers/control_token_hash');
const control_token_new = require('../helpers/control_token_new');
const control_token_sweep = require('../helpers/control_token_sweep');
const control_tokens_read = require('../helpers/control_tokens_read');
const control_tokens_write = require('../helpers/control_tokens_write');
const crypto = require('crypto');
const log_event = require('../helpers/log_event');
const path = require('path');
const send_json = require('../helpers/send_json');
const service_app_folder = require('../helpers/service_app_folder');

const BODY_LIMIT_BYTES = 16*1024;
const LABEL_MAX = 100;
const FOLDER_MAX = 500;
const FOLDERS_MAX = 20;
const SERVICES_MAX = 50;
// A year: the page stays signed in until its owner signs out or the token changes
const COOKIE_MAX_AGE_S = 365*24*60*60;
const RE_TOKEN = /^\/api\/v1\/tokens\/([0-9a-f]+)$/;
const RE_TOKEN_ROTATE = /^\/api\/v1\/tokens\/([0-9a-f]+)\/rotate$/;

// POST /api/v1/session (body)        the owner signs the page in: {token}
// DELETE /api/v1/session             and out
// GET /api/v1/tokens                 the tokens made; the rights there are, the machines and the app folders
// POST /api/v1/tokens (body)         one more: {label, remotes, rights, folders, services}, said once
// PUT /api/v1/tokens/<id> (body)     the same fields, changed; the token itself stays
// POST /api/v1/tokens/<id>/rotate    a new value, said once; the old one is refused at once
// DELETE /api/v1/tokens/<id>         revoked, at once
//
// The last three cut what the token may no longer do at once, its open connections and the
// forwards it asked for, and answer forwards_set_aside: the labels of those set aside
// (control_token_sweep).
//
// True when the request was one of these. Signing in is open to any caller of the control
// door, since it is how a token is brought; the rest is the owner's, checked before this.
async function handle_control_tokens(app, req, res, url)
{
    if (url.pathname === '/api/v1/session') {
        if (req.method === 'POST') {
            await session_open(app, req, res);
            return true;
        }
        if (req.method === 'DELETE') {
            res.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'set-cookie': cookie_of(req, '', 0), 'cache-control': 'no-store'});
            res.end('{}');
            return true;
        }
    }
    if ((url.pathname === '/api/v1/tokens') && (req.method === 'GET')) {
        send_json(res, 200, {tokens: control_tokens_read(app).map(token_view), rights: control_route_right.RIGHTS, remotes: app.remotes.map(v => v.name), services: app_folders(app), socket: socket_shown(app), port: control_port(app), owner_token_file: (String(process.env.SERVICEMAN_OWNER_TOKEN || '').trim() === '') ? 'data/owner.token' : null});
        return true;
    }
    if ((url.pathname === '/api/v1/tokens') && (req.method === 'POST')) {
        await token_make(app, req, res);
        return true;
    }
    const one = RE_TOKEN.exec(url.pathname);
    if ((one !== null) && (req.method === 'PUT')) {
        await token_change(app, req, res, one[1]);
        return true;
    }
    const rotate = RE_TOKEN_ROTATE.exec(url.pathname);
    if ((rotate !== null) && (req.method === 'POST')) {
        await token_rotate(app, res, rotate[1]);
        return true;
    }
    if ((one !== null) && (req.method === 'DELETE')) {
        const tokens = control_tokens_read(app);
        const found = tokens.find(v => v.id === one[1]);
        if (found === undefined) {
            send_json(res, 404, {error: `no token ${one[1]}`});
            return true;
        }
        control_tokens_write(app, tokens.filter(v => v !== found));
        log_event(app, 'control_token_revoked', {id: found.id, label: found.label});
        send_json(res, 200, {forwards_set_aside: await control_token_sweep(app, found.id)});
        return true;
    }
    return false;
}

async function session_open(app, req, res)
{
    let body;
    try {
        body = JSON.parse(await body_read(req, BODY_LIMIT_BYTES));
    }
    catch (error) {
        send_json(res, 400, {error: error.message});
        return;
    }
    const token = ((body !== null) && (typeof body.token === 'string')) ? body.token.trim() : '';
    const caller = control_caller(app, {headers: {authorization: `Bearer ${token}`}});
    if ((caller === null) || (caller.owner === false)) {
        log_event(app, 'control_sign_in_refused', {client: req.socket.remoteAddress, reason: (caller === null) ? 'unknown_token' : 'not_the_owner'});
        send_json(res, 401, {error: (caller === null) ? 'That is not the owner\'s token' : 'An agent\'s token is sent with each request, not signed in'});
        return;
    }
    log_event(app, 'control_signed_in', {client: req.socket.remoteAddress});
    res.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'set-cookie': cookie_of(req, token, COOKIE_MAX_AGE_S), 'cache-control': 'no-store'});
    res.end('{}');
}

async function token_make(app, req, res)
{
    const fields = await fields_read(app, req, res);
    if (fields === null) {
        return;
    }
    const token = control_token_new();
    const item = Object.assign({id: crypto.randomBytes(8).toString('hex'), sha256: control_token_hash(token)}, fields, {made_at: new Date().toISOString()});
    control_tokens_write(app, control_tokens_read(app).concat([item]));
    log_event(app, 'control_token_made', fields_logged(item));
    send_json(res, 200, {token, item: token_view(item)});
}

// What the token may do, changed; the token itself stays, so whoever holds it goes on with it
async function token_change(app, req, res, id)
{
    const found = control_tokens_read(app).find(v => v.id === id);
    if (found === undefined) {
        send_json(res, 404, {error: `no token ${id}`});
        return;
    }
    const fields = await fields_read(app, req, res);
    if (fields === null) {
        return;
    }
    const item = Object.assign({}, found, fields);
    control_tokens_write(app, control_tokens_read(app).map(v => (v.id === id) ? item : v));
    log_event(app, 'control_token_changed', fields_logged(item));
    send_json(res, 200, {item: token_view(item), forwards_set_aside: await control_token_sweep(app, id)});
}

// A token rotated, for one that was lost or seen: a new value with the same rights, said once,
// the old one refused from now on, what it holds open cut
async function token_rotate(app, res, id)
{
    const found = control_tokens_read(app).find(v => v.id === id);
    if (found === undefined) {
        send_json(res, 404, {error: `no token ${id}`});
        return;
    }
    const token = control_token_new();
    const item = Object.assign({}, found, {sha256: control_token_hash(token), rotated_at: new Date().toISOString()});
    delete item.used_at;
    control_tokens_write(app, control_tokens_read(app).map(v => (v.id === id) ? item : v));
    log_event(app, 'control_token_rotated', {id: item.id, label: item.label});
    send_json(res, 200, {token, item: token_view(item), forwards_set_aside: await control_token_sweep(app, id)});
}

// The label, machines, rights, folders and apps a request asks a token to have, checked, or
// null with the 400 that says what is wrong already sent. A machine of `*` is every machine,
// those added later too.
async function fields_read(app, req, res)
{
    let body;
    try {
        body = JSON.parse(await body_read(req, BODY_LIMIT_BYTES));
    }
    catch (error) {
        send_json(res, 400, {error: error.message});
        return null;
    }
    const asked = ((body === null) || (typeof body !== 'object')) ? {} : body;
    const label = (typeof asked.label === 'string') ? asked.label.trim() : '';
    if ((label === '') || (label.length > LABEL_MAX) || /[\r\n]/.test(label)) {
        send_json(res, 400, {error: `a token has a label: one line, up to ${LABEL_MAX} characters`});
        return null;
    }
    const named = Array.isArray(asked.remotes) ? Array.from(new Set(asked.remotes.map(String))) : [];
    const remotes = named.includes('*') ? ['*'] : named;
    const unknown = remotes.filter(v => (v !== '*') && (app.remote_by_name[v] === undefined));
    if (unknown.length > 0) {
        send_json(res, 400, {error: `no remote named ${unknown.map(v => JSON.stringify(v)).join(', ')}`});
        return null;
    }
    const rights = Array.isArray(asked.rights) ? Array.from(new Set(asked.rights.map(String))) : [];
    const wrong = rights.filter(v => (control_route_right.RIGHTS.includes(v) === false));
    if ((rights.length === 0) || (wrong.length > 0)) {
        send_json(res, 400, {error: `a token has some of the rights ${control_route_right.RIGHTS.join(', ')}`});
        return null;
    }
    // The files right is of some folders, the same paths on each of its machines, ~ their homes
    const folders = (Array.isArray(asked.folders) && rights.includes('files')) ? Array.from(new Set(asked.folders.map(v => String(v).trim()).filter(v => (v !== '')))) : [];
    if (rights.includes('files') && ((folders.length === 0) || (folders.length > FOLDERS_MAX) || folders.some(v => (v.length > FOLDER_MAX) || /[\r\n\0]/.test(v)))) {
        send_json(res, 400, {error: `the files right is of 1 to ${FOLDERS_MAX} folders, such as ~/notes or /srv/data, each one line of up to ${FOLDER_MAX} characters`});
        return null;
    }
    // The versions right is of every app folder on its machines, or kept to the apps named
    const services = (Array.isArray(asked.services) && rights.includes('versions')) ? Array.from(new Set(asked.services.map(v => String(v).trim()).filter(v => (v !== '')))) : [];
    const not_app = services.filter(v => (app_folders(app).includes(v) === false));
    if (not_app.length > 0) {
        send_json(res, 400, {error: `no app folder named ${not_app.map(v => JSON.stringify(v)).join(', ')}`});
        return null;
    }
    if (services.length > SERVICES_MAX) {
        send_json(res, 400, {error: `the versions right is kept to at most ${SERVICES_MAX} apps`});
        return null;
    }
    return {label, remotes, rights, folders, services};
}

function fields_logged(item)
{
    return {id: item.id, label: item.label, remotes: item.remotes.join(','), rights: item.rights.join(','), folders: item.folders.join(','), services: item.services.join(',')};
}

// The services a versions right can be kept to: the app folders, by name
function app_folders(app)
{
    return app.services.filter(v => (service_app_folder(v) !== null)).map(v => v.name);
}

// The control socket as it is named from serviceman's own folder, data/serviceman.sock, the
// way a line copied from the page is typed on that machine; null without one
function socket_shown(app)
{
    const socket = app.config.control.socket;
    if ((typeof socket !== 'string') || (socket === '')) {
        return null;
    }
    const base = path.dirname(app.state_dir);
    const full = path.resolve(base, socket);
    return full.startsWith(`${base}${path.sep}`) ? path.relative(base, full) : full;
}

// The control port as it is listened on, the config's 0 being whichever was free; null without one
function control_port(app)
{
    if ((app.servers !== undefined) && (app.servers.control !== null) && (app.servers.control !== undefined)) {
        return app.servers.control.address().port;
    }
    return app.config.control.port;
}

// A token as the page sees it: everything but its hash
function token_view(token)
{
    return {id: token.id, label: token.label, remotes: token.remotes, rights: token.rights, folders: Array.isArray(token.folders) ? token.folders : [], services: Array.isArray(token.services) ? token.services : [], made_at: token.made_at, rotated_at: (token.rotated_at === undefined) ? null : token.rotated_at, used_at: (token.used_at === undefined) ? null : token.used_at};
}

// The page's cookie: for this page alone and its machine-files addresses under the same name,
// never sent by another site, never read by a script, and never over plain http once the page
// came over https (a TLS front in front of the control door says so in x-forwarded-proto)
function cookie_of(req, value, max_age_s)
{
    const host = String((req.headers.host === undefined) ? '' : req.headers.host).replace(/:\d+$/, '');
    const named = /^[a-z0-9.-]+$/i.test(host) && host.includes('.') && (/^[0-9.]+$/.test(host) === false);
    const secure = (req.socket.encrypted === true) || (String((req.headers['x-forwarded-proto'] === undefined) ? '' : req.headers['x-forwarded-proto']).split(',')[0].trim() === 'https');
    return `${control_caller.COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${max_age_s}; HttpOnly; SameSite=Strict${named ? `; Domain=${host}` : ''}${secure ? '; Secure' : ''}`;
}

module.exports = handle_control_tokens;
