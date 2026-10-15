const agent_bundle = require('../../../agent/bundler/agent_bundle');
const agent_install_sh = require('../helpers/agent_install_sh');
const app_apply_config = require('../helpers/app_apply_config');
const apt_lane = require('../helpers/apt_lane');
const body_read = require('../body_read');
const config_from_json = require('../helpers/config_from_json');
const config_locked = require('../helpers/config_locked');
const container_disk = require('../../../../modules/docker/server/container_disk');
const control_allowed = require('../control_allowed');
const control_host_allowed = require('../control_host_allowed');
const control_same_origin = require('../control_same_origin');
const crypto = require('crypto');
const docker_exec_connect = require('../helpers/docker_exec_connect');
const docker_serve = require('../../../../modules/docker/server/docker_serve');
const docker_shell = require('../helpers/docker_shell');
const file_manager_serve = require('../../../../modules/file_manager/server/file_manager_serve');
const file_manager_transfers_serve = require('../../../../modules/file_manager/server/file_manager_transfers_serve');
const firewall_serve = require('../../../../modules/firewall/server/firewall_serve');
const from_loopback_page = require('../helpers/from_loopback_page');
const from_this_machine = require('../helpers/from_this_machine');
const fs = require('fs');
const fs_host_of = require('../helpers/fs_host_of');
const load_test_log_path = require('../helpers/load_test_log_path');
const load_test_run = require('../helpers/load_test_run');
const load_test_stop = require('../helpers/load_test_stop');
const load_test_url = require('../helpers/load_test_url');
const log_event = require('../helpers/log_event');
const log_within = require('../helpers/log_within');
const logline_from_json = require('../helpers/logline_from_json');
const path = require('path');
const remote_call = require('../helpers/remote_call');
const remote_can = require('../helpers/remote_can');
const remote_disk = require('../helpers/remote_disk');
const remote_removed_add = require('../helpers/remote_removed_add');
const remote_tags = require('../helpers/remote_tags');
const remote_update_call = require('../helpers/remote_update_call');
const render_error_page = require('../helpers/render_error_page');
const render_index_collection = require('../render_index_collection');
const secrets_read = require('../helpers/secrets_read');
const secrets_write = require('../helpers/secrets_write');
const send_json = require('../helpers/send_json');
const serve_static_file = require('../helpers/serve_static_file');
const service_ensure_running = require('../helpers/service_ensure_running');
const service_image_pull = require('../helpers/service_image_pull');
const service_reinstall = require('../helpers/service_reinstall');
const service_restart = require('../helpers/service_restart');
const service_stop = require('../helpers/service_stop');
const service_try_again = require('../helpers/service_try_again');
const skins_read = require('../skins_read');
const socket_pending = require('../helpers/socket_pending');
const term_name_valid = require('../../../helpers/term_name_valid');
const transfer_queue = require('../../../../modules/file_manager/server/transfer_queue');
const url_logged = require('../helpers/url_logged');
const view_from_forward = require('../helpers/view_from_forward');
const view_from_remote = require('../helpers/view_from_remote');
const view_from_service = require('../helpers/view_from_service');
const volumes_of_app = require('../helpers/volumes_of_app');
const volumes_serve = require('../../../../modules/volumes/server/volumes_serve');

const BODY_LIMIT_BYTES = 1024*1024;

const RE_ACTION = /^\/api\/v1\/services\/([^/]+)\/(start|stop|restart|update|pull)$/;
const RE_REMOTE = /^\/api\/v1\/remotes\/([^/]+)$/;
const RE_REMOTE_SCREENSHOT = /^\/api\/v1\/remotes\/([^/]+)\/screenshot$/;
const RE_REMOTE_APT = /^\/api\/v1\/remotes\/([^/]+)\/apt$/;
const RE_REMOTE_APT_DO = /^\/api\/v1\/remotes\/([^/]+)\/(apt-upgrade|apt-cancel)$/;
const RE_REMOTE_LOGS = /^\/api\/v1\/remotes\/([^/]+)\/logs$/;
// The File Manager module's API, one machine's disk under each
const RE_REMOTE_FS = /^\/api\/v1\/remotes\/([^/]+)\/fs(\/.*)?$/;
const RE_UPLOAD_PART = /^\/api\/v1\/remotes\/[^/]+\/fs\/upload\/part$/;
// The Docker module's API, one machine's docker engine under each
const RE_REMOTE_DOCKER = /^\/api\/v1\/remotes\/([^/]+)\/docker(\/.*)?$/;
const RE_CONTAINER_FS = /^\/containers\/([0-9a-f]{12,64})\/fs(\/.*)?$/;
// The Firewall module's API, one machine's firewall and ports under each
const RE_REMOTE_FIREWALL = /^\/api\/v1\/remotes\/([^/]+)\/firewall(\/.*)?$/;
// The Volumes module's API, one machine's encrypted volumes under each
const RE_REMOTE_VOLUMES = /^\/api\/v1\/remotes\/([^/]+)\/volumes(\/.*)?$/;
// Copies of files from one machine to another, run here and not by a page
const RE_TRANSFERS = /^\/api\/v1\/transfers(\/.*)?$/;
const RE_REMOTE_PROCESSES = /^\/api\/v1\/remotes\/([^/]+)\/processes$/;
const RE_REMOTE_TERMINALS = /^\/api\/v1\/remotes\/([^/]+)\/terminals$/;
const RE_REMOTE_METRICS = /^\/api\/v1\/remotes\/([^/]+)\/metrics$/;
const RE_REMOTE_TERMINAL_END = /^\/api\/v1\/remotes\/([^/]+)\/terminals\/([^/]+)\/end$/;
const RE_REMOTE_TERMINAL_SIGNAL = /^\/api\/v1\/remotes\/([^/]+)\/terminals\/([^/]+)\/signal$/;
const RE_REMOTE_PORTS = /^\/api\/v1\/remotes\/([^/]+)\/ports$/;
const RE_REMOTE_DISKS = /^\/api\/v1\/remotes\/([^/]+)\/disks$/;
const RE_REMOTE_PACKAGES = /^\/api\/v1\/remotes\/([^/]+)\/packages$/;
// ps and ss answer at once; the wait is for a machine thinking about it
const MACHINE_READ_TIMEOUT_MS = 15000;
const METRICS_RANGES = ['1h', '24h', '7d', '30d'];
const RE_REMOTE_AGENT = /^\/api\/v1\/remotes\/([^/]+)\/agent-update$/;
// Installing everything a machine is behind on is a job of minutes, sometimes many
const APT_TIMEOUT_MS = 3600000;
// A screen is a few megabytes over a link, and a machine that will not take the picture says
// so quickly; the wait is for the one that thinks about it
const SCREENSHOT_TIMEOUT_MS = 30000;
// ufw takes a second or two to write its rules; the agent gives up on it at thirty
const UFW_TIMEOUT_MS = 40000;
// Making a volume copies the plain files in, which takes as long as they are big
const VOLUME_TIMEOUT_MS = 600000;
const RE_SERVICE = /^\/api\/v1\/services\/([^/]+)$/;
const RE_LOAD_TEST = /^\/api\/v1\/load-tests\/([^/]+)$/;
const RE_LOAD_TEST_DO = /^\/api\/v1\/load-tests\/([^/]+)\/(run|stop)$/;
const RE_LOAD_TEST_LOG = /^\/api\/v1\/load-test-runs\/([0-9a-f]+)\/log$/;

const RE_SECRET = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
// The uid of the group a log line belongs to: [time][uid][sender] words

const CONTROL_SITE = {name: 'serviceman', type: 'static', root: path.join(__dirname, '..', '..', 'public'), fresh: true, one_page: true};

// The addresses the control page has, besides the front: a pane with a word of its own, and a
// page per service and per machine with its tabs. Anything else is a mistyped address, and gets
// a 404 rather than the front page — which opens whatever it opens first, and looks like an answer.
const PAGE_PANES = ['services', 'remotes', 'addresses', 'config', 'storage', 'secrets', 'networking', 'forwards', 'join', 'map', 'logline', 'authwall', 'load-tests'];
const SERVICE_TABS = ['overview', 'settings', 'logs', 'shell'];
const REMOTE_TABS = ['overview', 'configure', 'files', 'docker', 'firewall', 'logs', 'ports', 'processes', 'disks', 'packages', 'settings', 'shell', 'install'];
const SKINS_ROOT = path.join(__dirname, '..', '..', 'skins');
const SKINS_SITE = {name: 'serviceman-skins', type: 'static', root: SKINS_ROOT, fresh: true};
// The page halves of the modules, each served from the ui folder of its own module
const RE_MODULE = /^\/modules\/([^/]+)\//;
const MODULE_SITES = {
    docker: {name: 'docker', type: 'static', root: path.join(__dirname, '..', '..', '..', '..', 'modules', 'docker', 'ui'), fresh: true},
    file_manager: {name: 'file_manager', type: 'static', root: path.join(__dirname, '..', '..', '..', '..', 'modules', 'file_manager', 'ui'), fresh: true},
    terminal: {name: 'terminal', type: 'static', root: path.join(__dirname, '..', '..', '..', '..', 'modules', 'terminal', 'ui'), fresh: true},
    firewall: {name: 'firewall', type: 'static', root: path.join(__dirname, '..', '..', '..', '..', 'modules', 'firewall', 'ui'), fresh: true},
    volumes: {name: 'volumes', type: 'static', root: path.join(__dirname, '..', '..', '..', '..', 'modules', 'volumes', 'ui'), fresh: true},
};

// The control page and the calls behind it
function handle_control_request(app, req, res)
{
    socket_pending(req.socket, res);
    // Under the connection it came in on, not a group of its own: what a control request
    // causes gets groups, the asking does not
    return log_within(req.socket.log_group, () => control_answer(app, req, res));
}

async function control_answer(app, req, res)
{
    const url = new URL(req.url, 'http://serviceman.invalid');
    // phone.fs.serviceman.localhost is the files of phone, the whole disk under the address's
    // root — so a page served from it finds its neighbours by relative links alone. The name
    // is the control host with two labels in front, so a stranger's name still reaches
    // nothing, and the same wall stands: who may not open the control page may not open this.
    const fs_host = fs_host_of(app, req);
    if (fs_host !== null) {
        if (control_allowed(app, req) === false) {
            control_refuse(app, req, res);
            return;
        }
        if ((req.method !== 'GET') && (req.method !== 'HEAD')) {
            render_error_page(res, 405, 'Only GET is served here', `${fs_host} is a machine's files`);
            return;
        }
        await handle_fs(app, req, res, fs_host, `/file${url.pathname}`);
        return;
    }
    // The agent is public code and holds no secret; a machine far away must be able to take it
    if ((url.pathname === '/api/v1/agent.js') && (req.method === 'GET')) {
        send_agent(res);
        return;
    }
    // The installer carries no secret either, and it has to be readable by a machine that has
    // nothing yet — the token is given to it, not baked into it
    if ((url.pathname === '/api/v1/install.sh') && (req.method === 'GET')) {
        send_install(app, req, res);
        return;
    }
    if ((control_allowed(app, req) === false) || (control_host_allowed(app, req) === false)) {
        control_refuse(app, req, res);
        return;
    }
    // A page on another site may send a write here from the operator's own browser
    if ((req.method !== 'GET') && (req.method !== 'HEAD') && (control_same_origin(req) === false)) {
        cross_site_refuse(app, req, res);
        return;
    }
    // Every change asked of the control page is written down: what it was, and from where.
    // A HEAD asks, it changes nothing — a player probing a file is not a change. Nor is each
    // part of a file sent in parts: the file is written down once, when it is in.
    if ((req.method !== 'GET') && (req.method !== 'HEAD') && (RE_UPLOAD_PART.test(url.pathname) === false)) {
        log_event(app, 'control_change', {client: req.socket.remoteAddress, method: req.method, path: url_logged(req.url)});
    }
    if (url.pathname === '/api/v1/status') {
        send_json(res, 200, state_from_app(app));
        return;
    }
    if ((url.pathname === '/navplace') && (req.method === 'GET')) {
        collection_send(app, res);
        return;
    }
    if ((url.pathname === '/api/v1/image-ports') && (req.method === 'GET')) {
        await image_ports(app, res, url.searchParams.get('image'), url.searchParams.get('remote'));
        return;
    }
    if ((url.pathname === '/api/v1/config') && (req.method === 'GET')) {
        await config_send(app, res);
        return;
    }
    if ((url.pathname === '/api/v1/config/check') && (req.method === 'POST')) {
        await config_check(app, req, res);
        return;
    }
    if ((url.pathname === '/api/v1/config') && (req.method === 'POST')) {
        await config_save(app, req, res);
        return;
    }
    if ((url.pathname === '/api/v1/services') && (req.method === 'POST')) {
        await service_create(app, req, res);
        return;
    }
    if ((url.pathname === '/api/v1/remotes') && (req.method === 'POST')) {
        await remote_create(app, req, res);
        return;
    }
    if ((url.pathname === '/api/v1/volumes') && (req.method === 'GET')) {
        send_json(res, 200, {volumes: volumes_of_app(app)});
        return;
    }
    if ((url.pathname === '/api/v1/secrets') && (req.method === 'GET')) {
        secrets_list(app, res);
        return;
    }
    if ((url.pathname === '/api/v1/skins') && (req.method === 'GET')) {
        send_json(res, 200, {skins: await skins_read(SKINS_ROOT)});
        return;
    }
    if ((url.pathname === '/api/v1/forwards') && (req.method === 'PUT')) {
        await forwards_put(app, req, res);
        return;
    }
    if ((url.pathname === '/api/v1/logline') && (req.method === 'PUT')) {
        await logline_put(app, req, res);
        return;
    }
    if ((url.pathname === '/api/v1/secrets') && (req.method === 'POST')) {
        await secrets_save(app, req, res);
        return;
    }
    if ((url.pathname === '/api/v1/join') && (req.method === 'POST')) {
        await join_save(app, req, res);
        return;
    }
    const remote_agent = RE_REMOTE_AGENT.exec(url.pathname);
    if ((remote_agent !== null) && (req.method === 'POST')) {
        await handle_agent_update(app, res, decodeURIComponent(remote_agent[1]));
        return;
    }
    const remote_logs = RE_REMOTE_LOGS.exec(url.pathname);
    if ((remote_logs !== null) && (req.method === 'PUT')) {
        await remote_logs_put(app, req, res, decodeURIComponent(remote_logs[1]));
        return;
    }
    const remote_docker = RE_REMOTE_DOCKER.exec(url.pathname);
    if (remote_docker !== null) {
        await handle_docker(app, req, res, decodeURIComponent(remote_docker[1]), ((remote_docker[2] === undefined) ? '' : remote_docker[2]));
        return;
    }
    const remote_firewall = RE_REMOTE_FIREWALL.exec(url.pathname);
    if (remote_firewall !== null) {
        await handle_firewall(app, req, res, decodeURIComponent(remote_firewall[1]), ((remote_firewall[2] === undefined) ? '' : remote_firewall[2]));
        return;
    }
    const remote_volumes = RE_REMOTE_VOLUMES.exec(url.pathname);
    if (remote_volumes !== null) {
        await handle_volumes(app, req, res, decodeURIComponent(remote_volumes[1]), ((remote_volumes[2] === undefined) ? '' : remote_volumes[2]));
        return;
    }
    const transfers = RE_TRANSFERS.exec(url.pathname);
    if (transfers !== null) {
        await file_manager_transfers_serve(req, res, {queue: transfers_of(app), tail: ((transfers[1] === undefined) ? '' : transfers[1]), disk_known: v => ((typeof v === 'string') && (app.remote_by_name[v] !== undefined))});
        return;
    }
    const remote_fs = RE_REMOTE_FS.exec(url.pathname);
    if (remote_fs !== null) {
        await handle_fs(app, req, res, decodeURIComponent(remote_fs[1]), ((remote_fs[2] === undefined) ? '' : remote_fs[2]));
        return;
    }
    const remote_processes = RE_REMOTE_PROCESSES.exec(url.pathname);
    if ((remote_processes !== null) && (req.method === 'GET')) {
        await handle_machine_read(app, res, decodeURIComponent(remote_processes[1]), 'proc_list', 'the process list');
        return;
    }
    const remote_metrics = RE_REMOTE_METRICS.exec(url.pathname);
    if ((remote_metrics !== null) && (req.method === 'GET')) {
        await handle_remote_metrics(app, res, decodeURIComponent(remote_metrics[1]), url.searchParams.get('range'));
        return;
    }
    const remote_terminals = RE_REMOTE_TERMINALS.exec(url.pathname);
    if ((remote_terminals !== null) && (req.method === 'GET')) {
        await handle_machine_read(app, res, decodeURIComponent(remote_terminals[1]), 'term_list', 'kept terminals');
        return;
    }
    if ((remote_terminals !== null) && (req.method === 'POST')) {
        await handle_terminal_create(app, req, res, decodeURIComponent(remote_terminals[1]));
        return;
    }
    const remote_ports = RE_REMOTE_PORTS.exec(url.pathname);
    if ((remote_ports !== null) && (req.method === 'GET')) {
        await handle_machine_read(app, res, decodeURIComponent(remote_ports[1]), 'port_list', 'the port list');
        return;
    }
    const remote_disks = RE_REMOTE_DISKS.exec(url.pathname);
    if ((remote_disks !== null) && (req.method === 'GET')) {
        await handle_machine_read(app, res, decodeURIComponent(remote_disks[1]), 'disk_list', 'the disk list');
        return;
    }
    const remote_packages = RE_REMOTE_PACKAGES.exec(url.pathname);
    if ((remote_packages !== null) && (req.method === 'GET')) {
        await handle_machine_read(app, res, decodeURIComponent(remote_packages[1]), 'package_list', 'the package list');
        return;
    }
    const remote_apt = RE_REMOTE_APT.exec(url.pathname);
    if ((remote_apt !== null) && (req.method === 'GET')) {
        handle_apt_read(app, res, decodeURIComponent(remote_apt[1]));
        return;
    }
    const remote_apt_do = RE_REMOTE_APT_DO.exec(url.pathname);
    if ((remote_apt_do !== null) && (req.method === 'POST')) {
        await handle_apt(app, res, decodeURIComponent(remote_apt_do[1]), remote_apt_do[2]);
        return;
    }
    const remote_terminal_end = RE_REMOTE_TERMINAL_END.exec(url.pathname);
    if ((remote_terminal_end !== null) && (req.method === 'POST')) {
        await handle_terminal_call(app, res, decodeURIComponent(remote_terminal_end[1]), 'term_end', {name: decodeURIComponent(remote_terminal_end[2])});
        return;
    }
    const remote_terminal_signal = RE_REMOTE_TERMINAL_SIGNAL.exec(url.pathname);
    if ((remote_terminal_signal !== null) && (req.method === 'POST')) {
        await handle_terminal_signal(app, req, res, decodeURIComponent(remote_terminal_signal[1]), decodeURIComponent(remote_terminal_signal[2]));
        return;
    }
    const remote_screenshot = RE_REMOTE_SCREENSHOT.exec(url.pathname);
    if ((remote_screenshot !== null) && (req.method === 'POST')) {
        await handle_screenshot(app, res, decodeURIComponent(remote_screenshot[1]));
        return;
    }
    const remote_path = RE_REMOTE.exec(url.pathname);
    if ((remote_path !== null) && (req.method === 'PUT')) {
        await remote_update(app, req, res, decodeURIComponent(remote_path[1]));
        return;
    }
    if ((remote_path !== null) && (req.method === 'DELETE')) {
        await remote_delete(app, req, res, decodeURIComponent(remote_path[1]));
        return;
    }
    if ((url.pathname === '/api/v1/load-tests') && (req.method === 'POST')) {
        await load_test_create(app, req, res);
        return;
    }
    const load_test_log = RE_LOAD_TEST_LOG.exec(url.pathname);
    if ((load_test_log !== null) && (req.method === 'GET')) {
        await load_test_log_send(app, res, load_test_log[1]);
        return;
    }
    const load_test_do = RE_LOAD_TEST_DO.exec(url.pathname);
    if ((load_test_do !== null) && (req.method === 'POST')) {
        await load_test_act(app, res, decodeURIComponent(load_test_do[1]), load_test_do[2]);
        return;
    }
    const load_test_path = RE_LOAD_TEST.exec(url.pathname);
    if ((load_test_path !== null) && (req.method === 'PUT')) {
        await load_test_update(app, req, res, decodeURIComponent(load_test_path[1]));
        return;
    }
    if ((load_test_path !== null) && (req.method === 'DELETE')) {
        await load_test_delete(app, res, decodeURIComponent(load_test_path[1]));
        return;
    }
    const service_path = RE_SERVICE.exec(url.pathname);
    if ((service_path !== null) && (req.method === 'PUT')) {
        await service_update(app, req, res, decodeURIComponent(service_path[1]));
        return;
    }
    if ((service_path !== null) && (req.method === 'DELETE')) {
        await service_delete(app, req, res, decodeURIComponent(service_path[1]));
        return;
    }

    const action = RE_ACTION.exec(url.pathname);
    if (action !== null) {
        handle_action(app, req, res, decodeURIComponent(action[1]), action[2]);
        return;
    }
    // The page answers to every address that is not a file, so a door that does not exist has
    // to say so before that: a caller asking for JSON is owed JSON, not a page.
    if (url.pathname.startsWith('/api/')) {
        send_json(res, 404, {error: `no such door: ${url.pathname}`});
        return;
    }
    // The looks of the page: /skins/<name>/skin.css and whatever else a skin carries. The
    // address is cut down to a path inside the skins folder; the folder guard of
    // serve_static_file keeps it there.
    if (url.pathname.startsWith('/skins/')) {
        await serve_static_file(app, SKINS_SITE, {url: req.url.slice('/skins'.length), method: req.method}, res, '/skins');
        return;
    }
    // A module's component and styles: /modules/<name>/<file>, from that module's own folder
    const module_name = RE_MODULE.exec(url.pathname);
    if ((module_name !== null) && (MODULE_SITES[module_name[1]] !== undefined)) {
        const mount = `/modules/${module_name[1]}`;
        await serve_static_file(app, MODULE_SITES[module_name[1]], {url: req.url.slice(mount.length), method: req.method}, res, mount);
        return;
    }
    if ((path.extname(url.pathname) === '') && (page_known(app, url.pathname) === false)) {
        render_error_page(res, 404, 'No such page', url.pathname);
        return;
    }
    await serve_static_file(app, CONTROL_SITE, req, res);
}

// Whether the page has something to show at this address — the same reading of it the page
// itself makes, asked here so that a wrong address is answered as one
function page_known(app, pathname)
{
    let parts;
    try {
        parts = pathname.split('/').filter(v => v !== '').map(v => decodeURIComponent(v));
    }
    catch {
        return false;
    }
    if (parts.length === 0) {
        return true;
    }
    if (parts.length === 1) {
        return PAGE_PANES.includes(parts[0]);
    }
    // A machine's Shell tab names the terminal open in it: /remotes/<name>/shell/<terminal>
    if (parts.length === 4) {
        return (parts[0] === 'remotes') && (app.remote_by_name[parts[1]] !== undefined) && (parts[2] === 'shell') && term_name_valid(parts[3]);
    }
    if (parts.length > 3) {
        return false;
    }
    if (parts[0] === 'services') {
        const named = ((parts[1] === 'new') || (app.service_by_name[parts[1]] !== undefined));
        return named && ((parts[2] === undefined) || SERVICE_TABS.includes(parts[2]));
    }
    if (parts[0] === 'remotes') {
        const named = ((parts[1] === 'new') || (app.remote_by_name[parts[1]] !== undefined));
        return named && ((parts[2] === undefined) || REMOTE_TABS.includes(parts[2]));
    }
    return false;
}

// A stranger hears what a stranger hears anywhere else: nothing answers on that address
function control_refuse(app, req, res)
{
    log_event(app, 'control_refused', {client: req.socket.remoteAddress, host: req.headers.host, method: req.method, path: url_logged(req.url), reason: 'not_this_machine'});
    render_error_page(res, 404, 'No service answers on this address', `${req.headers.host || 'the request carries no Host header'}${req.url}`);
}

function cross_site_refuse(app, req, res)
{
    log_event(app, 'control_cross_site_refused', {client: req.socket.remoteAddress, origin: req.headers.origin, site: req.headers['sec-fetch-site'], method: req.method, path: url_logged(req.url)});
    send_json(res, 403, {error: 'a change comes from the control page itself, not from another site'});
}

// POST /api/v1/remotes/<name>/agent-update
// The agent on that machine, fetched again now instead of when the clock next comes round.
// The file goes with the ask, so a machine whose agent the installer did not put there — a
// container above all — can take it too.
async function handle_agent_update(app, res, name)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    if (remote.state.phase !== 'online') {
        send_json(res, 409, {error: `${name} is not connected`});
        return;
    }
    remote.state.update_asked_at = Date.now();
    remote.state.update_asked_build = remote.state.agent_built;
    log_event(app, 'remote_update_asked', {remote: remote.name, running: remote.state.agent_built, serving: agent_bundle.built_at(), asked: 'by hand'});
    try {
        const answer = await remote_update_call(app, remote);
        if (answer.started === false) {
            remote.state.update_refused = answer.reason;
            log_event(app, 'remote_update_refused', {remote: remote.name, reason: answer.reason});
            send_json(res, 502, {error: answer.reason});
            return;
        }
        send_json(res, 200, {started: true});
    }
    catch (error) {
        remote.state.update_refused = error.message;
        log_event(app, 'remote_update_refused', {remote: remote.name, reason: error.message});
        send_json(res, 502, {error: error.message});
    }
}

// GET /api/v1/remotes/<name>/processes
// GET /api/v1/remotes/<name>/ports
// GET /api/v1/remotes/<name>/disks
// GET /api/v1/remotes/<name>/packages
// GET /api/v1/remotes/<name>/terminals
// What is running on that machine, what it is listening on, its disks, its packages and its
// kept terminals. Each
// is read when asked and kept nowhere: the agent runs ps, ss, df or dpkg, or reads its terminals' notes, over there as its own user, and what
// comes back is what that user may see.
async function handle_machine_read(app, res, name, method, what)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    if (remote.state.phase !== 'online') {
        send_json(res, 409, {error: `${name} is not connected`});
        return;
    }
    if (remote_can(remote, method) === false) {
        send_json(res, 400, {error: `the agent on ${name} is from before ${what} — its page says how it updates`});
        return;
    }
    try {
        const answer = await remote_call(app, remote, method, {}, MACHINE_READ_TIMEOUT_MS);
        send_json(res, 200, answer);
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

// GET /api/v1/remotes/<name>/fs (query)
// GET /api/v1/remotes/<name>/fs/file/<path> (header:range)
// GET /api/v1/remotes/<name>/fs/tar (query)
// GET /api/v1/remotes/<name>/fs/watch (query)
// GET /api/v1/remotes/<name>/fs/room (query)
// POST /api/v1/remotes/<name>/fs/rename (body)
// POST /api/v1/remotes/<name>/fs/delete (body)
// POST /api/v1/remotes/<name>/fs/mkdir (body)
// POST /api/v1/remotes/<name>/fs/upload (body, query)
// POST /api/v1/remotes/<name>/fs/upload/tar (body, query)
// One machine's files, through the File Manager module: the doors are the module's, the
// machine is asked over the link its agent dialled. The refusals are this host's own.
async function handle_fs(app, req, res, name, tail)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    if (remote.state.phase !== 'online') {
        send_json(res, 409, {error: `${name} is not connected`});
        return;
    }
    // Many files in one tar need an agent that reads one; the page hears 501 and sends them apart
    if ((tail === '/upload/tar') && (remote_can(remote, 'tar_put') === false)) {
        send_json(res, 501, {error: `the agent on ${name} is from before files come in one tar — its page says how it updates`});
        return;
    }
    // A file in parts needs an agent that keeps parts; the page hears 501 and sends it whole
    if (tail.startsWith('/upload/') && (remote_can(remote, 'file_parts') === false)) {
        send_json(res, 501, {error: `the agent on ${name} is from before files in parts — its page says how it updates`});
        return;
    }
    if (((tail === '') || (tail === '/')) && (new URL(req.url, 'http://serviceman.invalid').searchParams.get('tree') === '1') && (remote_can(remote, 'fs_tree_typed') === false)) {
        send_json(res, 400, {error: `the agent on ${name} is from before a whole tree is listed by type — its page says how it updates`});
        return;
    }
    // Nor can an agent from before the room is said: the page hears 501 and uploads unchecked
    if ((tail === '/room') && (remote_can(remote, 'fs_room') === false)) {
        send_json(res, 501, {error: `the agent on ${name} is from before a disk says its room — its page says how it updates`});
        return;
    }
    if ((tail === '/watch') && (remote_can(remote, 'fs_watch') === false)) {
        send_json(res, 400, {error: `the agent on ${name} is from before folders are watched — its page says how it updates`});
        return;
    }
    // A copy rides the files lane, which agents had before they could read a folder
    if (tail === '/upload') {
        if (remote_can(remote, 'files') === false) {
            send_json(res, 400, {error: `the agent on ${name} is from before files are copied — its page says how it updates`});
            return;
        }
    }
    else if (remote_can(remote, 'fs_list') === false) {
        send_json(res, 400, {error: `the agent on ${name} is from before the file manager — its page says how it updates`});
        return;
    }
    await file_manager_serve(req, res, {
        disk: remote_disk(app, remote),
        tail,
        name: remote.name,
        log: function (event, fields) {
            log_event(app, event, Object.assign({remote: remote.name}, fields));
        },
    });
}

// GET /api/v1/remotes/<name>/docker/containers
// POST /api/v1/remotes/<name>/docker/containers/<id>/<start|stop|restart>
// POST /api/v1/remotes/<name>/docker/projects/<project>/<update|recreate>
// GET /api/v1/remotes/<name>/docker/containers/<id>/fs… (the File Manager's API)
// One machine's docker, through the Docker module: the engine over the link to its socket,
// compose as the agent's docker command. A container serviceman runs is shown, not touched:
// its service starts and stops it.
async function handle_docker(app, req, res, name, tail)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    if (remote.state.phase !== 'online') {
        send_json(res, 409, {error: `${name} is not connected`});
        return;
    }
    let connect;
    try {
        connect = docker_exec_connect(app, remote);
    }
    catch {
        send_json(res, 409, {error: `docker on ${name} has no socket its agent can reach`});
        return;
    }
    // A container's files: the File Manager's API, over a disk the Docker module makes of it
    const files = RE_CONTAINER_FS.exec(tail);
    if (files !== null) {
        await file_manager_serve(req, res, {
            disk: container_disk(connect, files[1]),
            tail: ((files[2] === undefined) ? '' : files[2]),
            name: files[1].slice(0, 12),
            log: function (event, fields) {
                log_event(app, event, Object.assign({remote: remote.name, container: files[1].slice(0, 12)}, fields));
            },
        });
        return;
    }
    await docker_serve(req, res, {
        connect,
        run: v => docker_shell(app, remote, v),
        tail,
        own: v => v.startsWith('serviceman-'),
        log: function (event, fields) {
            log_event(app, event, Object.assign({remote: remote.name}, fields));
        },
    });
}

// GET /api/v1/remotes/<name>/firewall
// GET /api/v1/remotes/<name>/firewall/ports
// POST /api/v1/remotes/<name>/firewall/rules (body)
// POST /api/v1/remotes/<name>/firewall/rules/delete (body)
// POST /api/v1/remotes/<name>/firewall/<enable|disable>
// One machine's firewall and the ports it listens on, through the Firewall module: ufw is run
// as root by the machine's root half, or with sudo -n where it has none, and the ports are the
// same list the agent reads for every page
async function handle_firewall(app, req, res, name, tail)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    if (remote.state.phase !== 'online') {
        send_json(res, 409, {error: `${name} is not connected`});
        return;
    }
    if (remote_can(remote, 'ufw') === false) {
        send_json(res, 400, {error: `the agent on ${name} is from before the firewall — its page says how it updates`});
        return;
    }
    function ports_read() {
        return remote_call(app, remote, 'port_list', {}, MACHINE_READ_TIMEOUT_MS);
    }
    await firewall_serve(req, res, {
        run: v => remote_call(app, remote, 'ufw', {argv: v}, UFW_TIMEOUT_MS),
        // An agent from before the port list has none to give; the module says so
        ports: (remote_can(remote, 'port_list') ? ports_read : undefined),
        tail,
        log: function (event, fields) {
            log_event(app, event, Object.assign({remote: remote.name}, fields));
        },
    });
}

// GET /api/v1/remotes/<name>/volumes
// POST /api/v1/remotes/<name>/volumes (body)
// POST /api/v1/remotes/<name>/volumes/<volume>/<open|close|grow> (body)
// One machine's encrypted volumes, through the Volumes module: the machine's root half does the
// work. A key comes only from this machine or over TLS, and is never logged.
async function handle_volumes(app, req, res, name, tail)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    if (remote.state.phase !== 'online') {
        send_json(res, 409, {error: `${name} is not connected`});
        return;
    }
    if (remote_can(remote, 'volumes') === false) {
        send_json(res, 400, {error: `the agent on ${name} is from before volumes — its page says how it updates`});
        return;
    }
    await volumes_serve(req, res, {
        call: v => remote_call(app, remote, 'volume', v, VOLUME_TIMEOUT_MS),
        key_safe: (from_this_machine(req) || from_loopback_page(req) || (req.socket.encrypted === true)),
        tail,
        log: function (event, fields) {
            log_event(app, event, Object.assign({remote: remote.name}, fields));
        },
    });
}

// The copies between machines, made the first time they are asked about. A machine is a disk
// while it is connected with an agent that keeps parts; until then a copy to or from it waits.
function transfers_of(app)
{
    if (app.transfers === undefined) {
        app.transfers = transfer_queue({
            disk_of: function (name) {
                const remote = app.remote_by_name[name];
                if ((remote === undefined) || (remote.state.phase !== 'online') || (remote_can(remote, 'file_parts') === false)) {
                    return null;
                }
                return remote_disk(app, remote);
            },
            log: function (event, fields) {
                log_event(app, event, fields);
            },
        });
    }
    return app.transfers;
}

// GET /api/v1/remotes/<name>/apt
// What is waiting to be installed on that machine, and how the run that was asked for is going
function handle_apt_read(app, res, name)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    send_json(res, 200, remote.state.apt);
}

// POST /api/v1/remotes/<name>/apt-upgrade
// POST /api/v1/remotes/<name>/apt-cancel
// Installing what is waiting, and stopping it again — both by hand, both from the machine's
// page. Nothing here runs on a clock.
async function handle_apt(app, res, name, action)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    if (remote.state.phase !== 'online') {
        send_json(res, 409, {error: `${name} is not connected`});
        return;
    }
    if (remote_can(remote, 'apt') === false) {
        send_json(res, 400, {error: `the agent on ${name} is from before installing updates — its page says how it updates`});
        return;
    }
    const run = remote.state.apt;
    if (action === 'apt-cancel') {
        try {
            const answer = await remote_call(app, remote, 'apt_cancel', {});
            send_json(res, 200, answer);
        }
        catch (error) {
            send_json(res, 502, {error: error.message});
        }
        return;
    }
    if (run.phase === 'running') {
        send_json(res, 409, {error: `an upgrade is already running on ${name}`});
        return;
    }
    // The run outlives this request by minutes: the answer says it began, and the page reads
    // how it is going from the door above
    remote.state.apt = {phase: 'running', lines: [], started_at: Date.now(), ended_at: null, error: null};
    log_event(app, 'apt_begin', {remote: remote.name});
    const promise = remote_call(app, remote, 'apt_upgrade', {service: apt_lane}, APT_TIMEOUT_MS);
    promise.then(function (answer) {
        apt_ended(app, remote, (answer.cancelled ? 'cancelled' : (answer.ok ? 'ok' : 'error')), (answer.ok ? null : last_line_of(answer)));
    }, function (error) {
        apt_ended(app, remote, 'error', error.message);
    });
    send_json(res, 202, {started: true});
}

function apt_ended(app, remote, phase, error)
{
    const run = remote.state.apt;
    run.phase = phase;
    run.ended_at = Date.now();
    run.error = error;
    log_event(app, ((phase === 'ok') ? 'apt_end_ok' : 'apt_end_error'), {remote: remote.name, lines: run.lines.length, reason: ((error === null) ? undefined : error)});
    // What is waiting has just changed, and the page is looking at it: the machine is asked
    // again now rather than at the next heartbeat half a minute from here
    const promise = remote_call(app, remote, 'stats');
    promise.then(function (stats) {
        remote.state.stats = stats;
    }, function () {
        // The link went with the run; the next heartbeat says what is true
    });
}

function last_line_of(answer)
{
    const said = `${answer.stderr || ''}\n${answer.stdout || ''}`.trim().split('\n').filter(v => v.trim() !== '');
    return ((said.length === 0) ? `apt-get ended with ${answer.code}` : said[said.length - 1]);
}

// GET /api/v1/remotes/<name>/metrics?range=1h|24h|7d|30d
// The machine's charts: its numbers over the range, as its agent keeps them on its own disk.
// The last answer for each range is kept here too, and shown while the machine is away, with
// `away: true`: the minutes before it went are what the reader came for.
async function handle_remote_metrics(app, res, name, range)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    if (METRICS_RANGES.includes(range) === false) {
        send_json(res, 400, {error: `the range is one of ${METRICS_RANGES.join(', ')}`});
        return;
    }
    const kept = remote.state.metrics[range];
    if (remote.state.phase !== 'online') {
        if (kept === undefined) {
            send_json(res, 409, {error: `${name} is not connected, and its charts are kept on it`});
            return;
        }
        send_json(res, 200, Object.assign({}, kept, {away: true}));
        return;
    }
    if (remote_can(remote, 'metrics') === false) {
        send_json(res, 400, {error: `the agent on ${name} is from before charts: an update to 1.9 or newer brings them`, old_agent: true});
        return;
    }
    try {
        const answer = await remote_call(app, remote, 'metrics', {range}, MACHINE_READ_TIMEOUT_MS);
        remote.state.metrics[range] = answer;
        send_json(res, 200, Object.assign({}, answer, {away: false}));
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

// POST /api/v1/remotes/<name>/terminals (body: {name, cols, rows})
// A terminal kept on the machine, made without joining it: the name asked for, or the lowest
// number no terminal has. Answers {name, created}; created is false when it was running already.
async function handle_terminal_create(app, req, res, name)
{
    const body = JSON.parse((await body_read(req, BODY_LIMIT_BYTES)) || '{}');
    const remote = app.remote_by_name[name];
    let term = body.name;
    if (((term === undefined) || (term === null)) && (remote !== undefined) && (remote.state.phase === 'online')) {
        const listed = await remote_call(app, remote, 'term_list', {}, MACHINE_READ_TIMEOUT_MS);
        let n = 1;
        while (listed.items.some(v => v.name === String(n))) {
            n++;
        }
        term = String(n);
    }
    await handle_terminal_call(app, res, name, 'term_create', {name: term, cols: body.cols, rows: body.rows});
}

// POST /api/v1/remotes/<name>/terminals/<term>/signal (body: {signal, to})
// A signal into the terminal: to its shell (to: shell, the default), or to what runs in it in
// front (to: foreground), which SIGINT stops as Ctrl-C does
async function handle_terminal_signal(app, req, res, name, term)
{
    const body = JSON.parse((await body_read(req, BODY_LIMIT_BYTES)) || '{}');
    await handle_terminal_call(app, res, name, 'term_signal', {name: term, signal: body.signal, to: body.to});
}

// POST /api/v1/remotes/<name>/terminals/<term>/end
// The × of a terminal's tab goes through here too: the shell is hung up, as closing a terminal
// window does, and the terminal is gone at once — not left running for nobody
async function handle_terminal_call(app, res, name, method, params)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    if (remote.state.phase !== 'online') {
        send_json(res, 409, {error: `${name} is not connected`});
        return;
    }
    if ((remote_can(remote, 'term_list') === false) || ((method !== 'term_end') && (remote_can(remote, 'term_signal') === false))) {
        send_json(res, 400, {error: `the agent on ${name} is from before ${(method === 'term_end') ? 'kept terminals' : 'creating and signalling terminals'} — its page says how it updates`});
        return;
    }
    if (term_name_valid(params.name) === false) {
        send_json(res, 400, {error: `a terminal name is letters, digits, - and _, at most 64 of them: ${JSON.stringify(params.name)}`});
        return;
    }
    try {
        const answer = await remote_call(app, remote, method, params, MACHINE_READ_TIMEOUT_MS);
        log_event(app, 'terminal_call', {remote: remote.name, method, term: params.name});
        send_json(res, 200, answer);
    }
    catch (error) {
        send_json(res, 400, {error: error.message});
    }
}

// POST /api/v1/remotes/<name>/screenshot
// What is on that machine's screen, right now and only when asked. The picture is answered as
// a png and kept nowhere: this door reads a screen, it does not watch one.
async function handle_screenshot(app, res, name)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    if (remote.state.phase !== 'online') {
        send_json(res, 409, {error: `${name} is not connected`});
        return;
    }
    if (remote_can(remote, 'screenshot') === false) {
        send_json(res, 400, {error: `the agent on ${name} is from before screenshots — its page says how it updates`});
        return;
    }
    try {
        const answer = await remote_call(app, remote, 'screenshot', {}, SCREENSHOT_TIMEOUT_MS);
        if (answer.ok === false) {
            // Every way that was tried and what it said: on wayland this is the answer to
            // "what does this machine allow", not a footnote to a failure
            send_json(res, 502, {error: `no way to take a picture of the screen on ${name}`, tried: answer.tried});
            return;
        }
        const png = Buffer.from(answer.png, 'base64');
        log_event(app, 'screenshot_taken', {remote: remote.name, method: answer.method, bytes: png.length});
        res.writeHead(200, {'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'no-store'});
        res.end(png);
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}


// POST /api/v1/services/<name>/start
// POST /api/v1/services/<name>/stop
// POST /api/v1/services/<name>/restart
// POST /api/v1/services/<name>/update
function handle_action(app, req, res, name, action)
{
    if (req.method !== 'POST') {
        send_json(res, 405, {error: `${action} is a POST`});
        return;
    }
    const service = app.service_by_name[name];
    if (service === undefined) {
        send_json(res, 404, {error: `no service named ${name}`});
        return;
    }
    if (service.type === 'external') {
        send_json(res, 400, {error: `${name} runs somewhere else; serviceman gives it an address, nothing more`});
        return;
    }
    if ((action === 'update') && ((service.type !== 'shell') || (service.lifecycle.install === null))) {
        send_json(res, 400, {error: `${name} has no install line: there is nothing to fetch again`});
        return;
    }
    if ((action === 'pull') && (service.type !== 'docker')) {
        send_json(res, 400, {error: `${name} is not made from an image — there is nothing to pull`});
        return;
    }
    if (action === 'start') {
        // Asking is a change: whatever serviceman gave up on, it tries again now
        service_try_again(app, service);
    }
    const promise = action_promise(app, service, action);
    promise.catch(function (error) {
        log_event(app, 'control_error', {service: service.name, reason: error.message});
    });
    send_json(res, 202, view_from_service(service));
}

// GET /api/v1/secrets
// What is kept, and how long each value is. Never the values: a page that can show a secret is
// a page that can leak one, and there is no reason to look at what you already put there.
function secrets_list(app, res)
{
    const kept = secrets_read(app);
    const global = [];
    for (const name of Object.keys(kept.global).sort()) {
        global.push({name, length: kept.global[name].length});
    }
    const services = [];
    for (const service of Object.keys(kept.services).sort()) {
        for (const name of Object.keys(kept.services[service]).sort()) {
            services.push({service, name, length: kept.services[service][name].length});
        }
    }
    send_json(res, 200, {global, services});
}

// PUT /api/v1/logline (body)
// {endpoint, ui, admin_token}: where Logline is, typed on the page. The admin token goes into the
// Secrets library, never the config, and is not sent back; left empty, the one kept stays. An
// empty endpoint takes Logline out of the config, and no machine sends anything anywhere.
async function logline_put(app, req, res)
{
    const body = JSON.parse(await body_read(req, BODY_LIMIT_BYTES));
    const endpoint = String(((body.endpoint === undefined) || (body.endpoint === null)) ? '' : body.endpoint).trim();
    const ui = String(((body.ui === undefined) || (body.ui === null)) ? '' : body.ui).trim();
    const admin_token = String(((body.admin_token === undefined) || (body.admin_token === null)) ? '' : body.admin_token).trim();
    const admin = ((app.config.logline === null) ? 'logline' : app.config.logline.admin);
    if (endpoint !== '') {
        // A wrong address is refused before the token is kept, so nothing lands half-way
        try {
            logline_from_json({endpoint, admin, ui: ((ui === '') ? undefined : ui)}, 'logline');
        }
        catch (error) {
            send_json(res, 400, {error: error.message});
            return;
        }
    }
    if ((endpoint !== '') && (admin_token !== '')) {
        // Kept before the config names it: the machines are told the moment the config lands,
        // and the telling needs it
        const kept = secrets_read(app);
        kept.global[admin] = admin_token;
        secrets_write(app, kept);
        log_event(app, 'secret_written', {secret: admin});
    }
    await config_file_mutate(app, res, function (json) {
        if (endpoint === '') {
            delete json.logline;
            return null;
        }
        json.logline = {endpoint, admin};
        if (ui !== '') {
            json.logline.ui = ui;
        }
        return null;
    });
}

// POST /api/v1/secrets (body)
// One secret written down, or taken away when the value is empty. `service` says whose it is;
// without one it goes to the library. `copy_from` takes the value out of the library without it
// ever going out to a page and back.
async function secrets_save(app, req, res)
{
    const body = JSON.parse(await body_read(req, BODY_LIMIT_BYTES));
    const service = String(((body.service === undefined) || (body.service === null)) ? '' : body.service).trim();
    const name = String((body.name === undefined) ? '' : body.name).trim();
    if ((RE_SECRET.test(name) === false) || ((service !== '') && (RE_SECRET.test(service) === false))) {
        send_json(res, 400, {error: 'a name of letters, digits, - . and _ is required'});
        return;
    }
    const kept = secrets_read(app);
    let value = (((body.value === undefined) || (body.value === null)) ? '' : String(body.value));
    if ((body.copy_from !== undefined) && (body.copy_from !== null) && (body.copy_from !== '')) {
        const from = kept.global[String(body.copy_from)];
        if (from === undefined) {
            send_json(res, 404, {error: `nothing is kept under ${body.copy_from}`});
            return;
        }
        value = from;
    }
    const bag = ((service === '') ? kept.global : ((kept.services[service] === undefined) ? {} : kept.services[service]));
    if (value === '') {
        delete bag[name];
    }
    else {
        bag[name] = value;
    }
    if (service !== '') {
        kept.services[service] = bag;
        if (Object.keys(bag).length === 0) {
            delete kept.services[service];
        }
    }
    secrets_write(app, kept);
    log_event(app, ((value === '') ? 'secret_removed' : 'secret_written'), {service: ((service === '') ? null : service), secret: name});
    secrets_list(app, res);
}

function action_promise(app, service, action)
{
    if (action === 'update') {
        return service_reinstall(app, service);
    }
    if (action === 'pull') {
        return service_image_pull(app, service);
    }
    if (action === 'start') {
        return service_ensure_running(app, service);
    }
    if (action === 'restart') {
        return service_restart(app, service);
    }
    return service_stop(app, service, 'asked from the control page');
}


// The one-command install, with this host's address already in it. The address is the one the
// machine used to fetch it — a name behind tailscale, a public address, whatever answered — so
// the machine dials back exactly where it came from. `url` overrides it, for the odd case where
// this host is reached by one name and answers on another.
// GET /api/v1/install.sh (header:host)
function send_install(app, req, res)
{
    const text = agent_install_sh(where_from(app, req));
    res.writeHead(200, {
        'content-type': 'text/x-shellscript; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-store',
    });
    res.end(text);
}

// Where the machine reached this host: what it asked for, and the scheme it must have used
function where_from(app, req)
{
    const host = String(req.headers.host || '').trim();
    if ((host === '') || (host === 'localhost')) {
        return `http://127.0.0.1:${app.config.control.port}`;
    }
    return `${(req.socket.encrypted === true) ? 'https' : 'http'}://${host}`;
}

// GET /api/v1/agent.js
// The agent as one file, for a machine that has node and nothing else:
// curl -fsSL https://serviceman.example.com/api/v1/agent.js -o serviceman-agent.js
function send_agent(res)
{
    const text = agent_bundle();
    res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-store',
        'content-disposition': 'attachment; filename="serviceman-agent.js"',
    });
    res.end(text);
}

// GET /navplace
// Every service that has an address, as a NavPlace collection: the plain-text list its desktop
// app reads through `collection_url`, and any page can embed. The links are on the service
// door, whichever door this was asked on — and carry no port when it is the one a browser
// leaves out.
function collection_send(app, res)
{
    const port = ((app.listen_port === 80) ? '' : String(app.listen_port));
    const text = render_index_collection(app, port);
    res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-store',
    });
    res.end(text);
}

// GET /api/v1/image-ports (query)
// What the image itself says about its ports — for the form to guess the right one. The
// machine asked is the one named, or any online machine carrying the tag, or any online
// machine at all; a fleet with nobody online has no docker to ask, and answers no ports.
async function image_ports(app, res, image, remote_name)
{
    if ((typeof image !== 'string') || (image === '')) {
        send_json(res, 400, {error: 'an image name is required'});
        return;
    }
    const asked = ((remote_name === null) ? '' : remote_name);
    if ((asked !== '') && (asked.startsWith('#') === false) && (app.remote_by_name[asked] === undefined)) {
        send_json(res, 404, {error: `no remote named ${asked} is in the config`});
        return;
    }
    const remote = app.remotes.find(v => (v.state.phase === 'online') && remote_answers(v, asked));
    if (remote === undefined) {
        send_json(res, 200, {ports: []});
        return;
    }
    const answer = await docker_shell(app, remote, ['image', 'inspect', '--format', '{{json .Config.ExposedPorts}}', image]);
    const ports = [];
    if (answer.ok) {
        try {
            for (const key of Object.keys(JSON.parse(answer.stdout) || {})) {
                const port = parseInt(key, 10);
                if (Number.isInteger(port) && (ports.includes(port) === false)) {
                    ports.push(port);
                }
            }
        }
        catch {
        }
    }
    send_json(res, 200, {ports});
}

// Whether a machine is one of those the form named: itself, any machine with the tag, or any
function remote_answers(remote, asked)
{
    if (asked === '') {
        return true;
    }
    if (asked.startsWith('#')) {
        return remote_tags(remote).includes(asked.slice(1));
    }
    return remote.name === asked;
}

// GET /api/v1/config
async function config_send(app, res)
{
    if (app.config.path === undefined) {
        send_json(res, 400, {error: 'serviceman runs without a config file'});
        return;
    }
    const text = await fs.promises.readFile(app.config.path, 'utf8');
    send_json(res, 200, {path: app.config.path, text, hash: text_hash(text)});
}

// POST /api/v1/config/check (body)
async function config_check(app, req, res)
{
    const body = JSON.parse(await body_read(req, BODY_LIMIT_BYTES));
    const refused = config_refused(String(body.text), app.config.base_dir);
    if (refused !== null) {
        send_json(res, 200, {ok: false, error: refused});
        return;
    }
    send_json(res, 200, {ok: true});
}

// POST /api/v1/config (body)
function config_save(app, req, res)
{
    return config_locked(app, () => config_write(app, req, res));
}

async function config_write(app, req, res)
{
    if (app.config.path === undefined) {
        send_json(res, 400, {error: 'serviceman runs without a config file'});
        return;
    }
    const body = JSON.parse(await body_read(req, BODY_LIMIT_BYTES));
    const text = String(body.text);
    const on_disk = await fs.promises.readFile(app.config.path, 'utf8');
    if (text_hash(on_disk) !== body.hash) {
        send_json(res, 409, {error: 'the config changed on disk since the editor loaded it — load it again'});
        return;
    }
    const refused = config_refused(text, app.config.base_dir);
    if (refused !== null) {
        send_json(res, 400, {ok: false, error: refused});
        return;
    }
    const config = config_from_json(JSON.parse(text), app.config.base_dir);
    const tmp_path = `${app.config.path}.serviceman-save`;
    await fs.promises.writeFile(tmp_path, text);
    await fs.promises.rename(tmp_path, app.config.path);
    log_event(app, 'config_saved', {hash: text_hash(text)});
    const applied = await app_apply_config(app, config);
    send_json(res, 200, {ok: true, restart_needed: applied.restart_needed, notes: applied.notes, hash: text_hash(text)});
}

// POST /api/v1/services (body)
async function service_create(app, req, res)
{
    const service = service_from_body(JSON.parse(await body_read(req, BODY_LIMIT_BYTES)));
    if (service === null) {
        send_json(res, 400, {error: 'the body carries no service object'});
        return;
    }
    await config_file_mutate(app, res, function (json) {
        if (json.services.some(v => v.name === service.name)) {
            return `a service named ${JSON.stringify(service.name)} already exists`;
        }
        json.services.push(service);
        return null;
    });
}

// PUT /api/v1/services/<name> (body)
async function service_update(app, req, res, name)
{
    const service = service_from_body(JSON.parse(await body_read(req, BODY_LIMIT_BYTES)));
    if (service === null) {
        send_json(res, 400, {error: 'the body carries no service object'});
        return;
    }
    await config_file_mutate(app, res, function (json) {
        const at = json.services.findIndex(v => v.name === name);
        if (at === -1) {
            return `no service named ${name}`;
        }
        json.services[at] = service;
        return null;
    }, 404);
}

// DELETE /api/v1/services/<name>
async function service_delete(app, req, res, name)
{
    await config_file_mutate(app, res, function (json) {
        const at = json.services.findIndex(v => v.name === name);
        if (at === -1) {
            return `no service named ${name}`;
        }
        json.services.splice(at, 1);
        return null;
    }, 404);
}

// POST /api/v1/load-tests (body)
async function load_test_create(app, req, res)
{
    const test = load_test_from_body(JSON.parse(await body_read(req, BODY_LIMIT_BYTES)));
    await config_file_mutate(app, res, function (json) {
        json.load_tests = json.load_tests || [];
        if (json.load_tests.some(v => v.name === test.name)) {
            return `a load test named ${JSON.stringify(test.name)} already exists`;
        }
        json.load_tests.push(test);
        return null;
    });
}

// PUT /api/v1/load-tests/<name> (body)
async function load_test_update(app, req, res, name)
{
    const test = load_test_from_body(JSON.parse(await body_read(req, BODY_LIMIT_BYTES)));
    await config_file_mutate(app, res, function (json) {
        const at = (json.load_tests || []).findIndex(v => v.name === name);
        if (at === -1) {
            return `no load test named ${name}`;
        }
        json.load_tests[at] = test;
        return null;
    }, 404);
}

// DELETE /api/v1/load-tests/<name>
async function load_test_delete(app, res, name)
{
    await config_file_mutate(app, res, function (json) {
        const at = (json.load_tests || []).findIndex(v => v.name === name);
        if (at === -1) {
            return `no load test named ${name}`;
        }
        json.load_tests.splice(at, 1);
        if (json.load_tests.length === 0) {
            delete json.load_tests;
        }
        return null;
    }, 404);
}

// POST /api/v1/load-tests/<name>/run
// POST /api/v1/load-tests/<name>/stop
async function load_test_act(app, res, name, action)
{
    const test = app.config.load_tests.find(v => v.name === name);
    if (test === undefined) {
        send_json(res, 404, {error: `no load test named ${name}`});
        return;
    }
    const going = app.load_test_runs.find(v => (v.test === name) && (v.ended_at === null));
    if (action === 'stop') {
        if (going === undefined) {
            send_json(res, 409, {error: `${name} is not running`});
            return;
        }
        send_json(res, 202, {id: going.id});
        await load_test_stop(app, going).catch(function (error) {
            log_event(app, 'control_error', {test: name, reason: error.message});
        });
        return;
    }
    if (going !== undefined) {
        send_json(res, 409, {error: `${name} is running already`});
        return;
    }
    send_json(res, 202, {id: load_test_run(app, test).id});
}

// GET /api/v1/load-test-runs/<id>/log
// Everything k6 printed in one run: as far as it got while it runs, the file once it is over
async function load_test_log_send(app, res, id)
{
    const run = app.load_test_runs.find(v => v.id === id);
    if (run === undefined) {
        send_json(res, 404, {error: `no load test run ${id}`});
        return;
    }
    let text;
    if (run.ended_at === null) {
        text = `${run.lines.join('\n')}\n`;
    }
    else {
        try {
            text = await fs.promises.readFile(load_test_log_path(app, id), 'utf8');
        }
        catch {
            send_json(res, 404, {error: 'no log was kept for this run'});
            return;
        }
    }
    res.writeHead(200, {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'});
    res.end(text);
}

// The fields a load test has in the config, and nothing else the page sent
function load_test_from_body(body)
{
    const out = {name: body.name, service: body.service, remote: body.remote};
    if ((typeof body.url === 'string') && (body.url.trim() !== '')) {
        out.url = body.url.trim();
    }
    out.vus = body.vus;
    out.duration = body.duration;
    for (const name of ['p95_ms', 'errors_pct']) {
        if ((body[name] !== undefined) && (body[name] !== null) && (body[name] !== '')) {
            out[name] = body[name];
        }
    }
    return out;
}

// POST /api/v1/join (body)
// Who may add themselves: the whole `join` block at once, or null for nobody
async function join_save(app, req, res)
{
    const body = JSON.parse(await body_read(req, BODY_LIMIT_BYTES));
    const join = (((body.join === undefined) || (body.join === null)) ? null : object_from_body(body, 'join'));
    await config_file_mutate(app, res, function (json) {
        if (join === null) {
            delete json.join;
            return null;
        }
        json.join = join;
        return null;
    });
}

// POST /api/v1/remotes (body)
async function remote_create(app, req, res)
{
    const remote = object_from_body(JSON.parse(await body_read(req, BODY_LIMIT_BYTES)), 'remote');
    if (remote === null) {
        send_json(res, 400, {error: 'the body carries no remote object'});
        return;
    }
    await config_file_mutate(app, res, function (json) {
        if (json.remotes === undefined) {
            // The machines come before what runs on them, so the file stays readable
            const services = json.services;
            delete json.services;
            json.remotes = [];
            json.services = services;
        }
        if (json.remotes.some(v => v.name === remote.name)) {
            return `a remote named ${JSON.stringify(remote.name)} already exists`;
        }
        json.remotes.push(remote);
        return null;
    });
}

// PUT /api/v1/remotes/<name> (body)
async function remote_update(app, req, res, name)
{
    const remote = object_from_body(JSON.parse(await body_read(req, BODY_LIMIT_BYTES)), 'remote');
    if (remote === null) {
        send_json(res, 400, {error: 'the body carries no remote object'});
        return;
    }
    await config_file_mutate(app, res, function (json) {
        const at = (json.remotes || []).findIndex(v => v.name === name);
        if (at === -1) {
            return `no remote named ${name}`;
        }
        json.remotes[at] = remote;
        return null;
    }, 404);
}

// PUT /api/v1/remotes/<name>/logs (body)
// {"logs": "all"} sends every container's output on that machine to Logline, {"logs": "off"}
// sends none; "dirs" is the list of folders read besides, [{path, service}]. Either may come
// alone. Written into its entry in the config; off, and no folders, is what an entry without
// them means.
async function remote_logs_put(app, req, res, name)
{
    const json = JSON.parse(await body_read(req, BODY_LIMIT_BYTES));
    if ((json === null) || (typeof json !== 'object') || ((json.logs !== undefined) && (json.logs !== 'all') && (json.logs !== 'off')) || ((json.logs === undefined) && (json.dirs === undefined))) {
        send_json(res, 400, {error: '{"logs": "all"} or {"logs": "off"}, and "dirs": [{"path": …, "service": …}]'});
        return;
    }
    await config_file_mutate(app, res, function (config) {
        const found = (config.remotes || []).find(v => v.name === name);
        if (found === undefined) {
            return `no remote named ${name}`;
        }
        if (json.logs === 'all') {
            found.logs = 'all';
        }
        else if (json.logs === 'off') {
            delete found.logs;
        }
        if (Array.isArray(json.dirs) && (json.dirs.length > 0)) {
            // Checked with the rest of the config when it is read back: a wrong path is refused
            // there, with where it is wrong
            found.log_dirs = json.dirs.map(v => (((v.service === undefined) || (v.service === null) || (v.service === '')) ? {path: v.path} : {path: v.path, service: v.service}));
        }
        else if (json.dirs !== undefined) {
            delete found.log_dirs;
        }
        return null;
    }, 404);
}

// DELETE /api/v1/remotes/<name>
// A service that names the remote keeps it alive: the whole config is read again before it is
// written, and it refuses to lose a remote something needs
async function remote_delete(app, req, res, name)
{
    await config_file_mutate(app, res, function (json) {
        const at = (json.remotes || []).findIndex(v => v.name === name);
        if (at === -1) {
            return `no remote named ${name}`;
        }
        // The whole config is read again after this, and it would refuse a service that names
        // a machine which is no longer there — with a word about the service, which is not
        // what the person pressing Remove on a machine is looking at. So it is said here,
        // about the machine, and names what is keeping it.
        const named = (json.services || []).filter(v => service_names_remote(v, name)).map(v => v.name);
        if (named.length > 0) {
            return {
                status: 409,
                error: `${name} is where ${named.join(', ')} ${(named.length === 1) ? 'runs' : 'run'} — say where ${(named.length === 1) ? 'it runs' : 'they run'} instead, then take the machine away`,
                // The services by name as well as in the sentence, so the page can offer to
                // open them rather than leaving somebody to find them
                services: named,
            };
        }
        // Remembered before it goes: the machine may be asleep, and when it wakes it is owed
        // the reason its token stopped working
        remote_removed_add(app, json.remotes[at]);
        json.remotes.splice(at, 1);
        return null;
    }, 404);
}

// Whether a service in the config file names this machine. A tag is not a name: a service
// asking for #ui does not keep one machine alive.
function service_names_remote(service, name)
{
    if (service.remote === name) {
        return true;
    }
    return Array.isArray(service.remotes) && service.remotes.includes(name);
}

// PUT /api/v1/forwards {"forwards": [...]}
// The whole list, as the page edits it: written to the config, and the machines told
async function forwards_put(app, req, res)
{
    const body = JSON.parse((await body_read(req, BODY_LIMIT_BYTES)) || '{}');
    if (Array.isArray(body.forwards) === false) {
        send_json(res, 400, {error: 'forwards: a list is required'});
        return;
    }
    await config_file_mutate(app, res, function (json) {
        if (body.forwards.length === 0) {
            delete json.forwards;
            return null;
        }
        json.forwards = body.forwards;
        return null;
    });
}

// The one shape the form sends: {service: {...}} with a plain object inside
function service_from_body(body)
{
    return object_from_body(body, 'service');
}

function object_from_body(body, name)
{
    if ((body === null) || (typeof body[name] !== 'object') || (body[name] === null) || Array.isArray(body[name])) {
        return null;
    }
    return body[name];
}

// Reads the config file, lets the caller change it, refuses anything the validator refuses,
// then writes the file and applies it to the running app
function config_file_mutate(app, res, change, miss_status)
{
    return config_locked(app, () => config_file_write(app, res, change, miss_status));
}

async function config_file_write(app, res, change, miss_status)
{
    if (app.config.path === undefined) {
        send_json(res, 400, {error: 'serviceman runs without a config file'});
        return;
    }
    const json = JSON.parse(await fs.promises.readFile(app.config.path, 'utf8'));
    json.services = json.services || [];
    const miss = change(json);
    if (miss !== null) {
        // A refusal is a sentence, and sometimes a status of its own: what is not there is a
        // 404, what is there and in use is not
        const said = ((typeof miss === 'string') ? {error: miss, status: miss_status} : miss);
        send_json(res, said.status || miss_status || 400, Object.assign({error: said.error}, ((said.services === undefined) ? {} : {services: said.services})));
        return;
    }
    let config;
    try {
        config = config_from_json(json, app.config.base_dir);
    }
    catch (error) {
        send_json(res, 400, {error: error.message});
        return;
    }
    const text = `${JSON.stringify(json, null, 4)}\n`;
    const tmp_path = `${app.config.path}.serviceman-save`;
    await fs.promises.writeFile(tmp_path, text);
    await fs.promises.rename(tmp_path, app.config.path);
    const applied = await app_apply_config(app, config);
    send_json(res, 200, {ok: true, restart_needed: applied.restart_needed, notes: applied.notes});
}

// The reason the text cannot be a serviceman config, or null for a fine one
function config_refused(text, base_dir)
{
    try {
        config_from_json(JSON.parse(text), base_dir);
        return null;
    }
    catch (error) {
        return error.message;
    }
}

function text_hash(text)
{
    return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
}

function state_from_app(app)
{
    const now = Date.now();
    const services = [];
    for (const service of app.services) {
        services.push(view_from_service(service, now));
    }
    const remotes = [];
    for (const remote of app.remotes) {
        remotes.push(view_from_remote(remote, now, app.config.logline));
    }
    return {
        now,
        started_at: app.started_at,
        // The agent this host serves: a machine running an older one is a machine to update
        agent_built: agent_bundle.built_at(),
        listen: app.config.listen,
        control: app.config.control,
        // Whether a machine may add itself, and what it may claim — never the token itself
        join: ((app.config.join === null) ? null : {tags_allowed: app.config.join.tags_allowed, name_prefix: app.config.join.name_prefix}),
        // Where Logline is, and whether its admin token is kept — never the token itself
        logline: ((app.config.logline === null) ? null : {
            endpoint: app.config.logline.endpoint,
            ui: app.config.logline.ui,
            admin: app.config.logline.admin,
            admin_kept: secrets_read(app).global[app.config.logline.admin] !== undefined,
        }),
        services,
        remotes,
        forwards: app.config.forwards.map(v => view_from_forward(app, v)),
        // Where a forward that shows up on serviceman itself puts its socket file
        state_dir: app.state_dir,
        // What k6 is sent at, each with the address it asks, and the runs so far, oldest first
        load_tests: app.config.load_tests.map(v => Object.assign({}, v, {url_asked: load_test_url(app, v)})),
        // A run's lines are its log, asked for when opened; one going shows its last few
        load_test_runs: app.load_test_runs.map(v => Object.assign({}, v, {lines: (v.ended_at === null) ? v.lines.slice(-40) : []})),
    };
}

module.exports = handle_control_request;
