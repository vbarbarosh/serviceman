const agent_bundle = require('../../../agent/bundler/agent_bundle');
const agent_install_sh = require('../helpers/agent_install_sh');
const app_apply_config = require('../helpers/app_apply_config');
const apt_all_run = require('../helpers/apt_all_run');
const apt_run = require('../helpers/apt_run');
const body_read = require('../body_read');
const config_from_json = require('../helpers/config_from_json');
const config_locked = require('../helpers/config_locked');
const container_disk = require('../../../../modules/docker/server/container_disk');
const control_allowed = require('../control_allowed');
const control_caller = require('../helpers/control_caller');
const control_host_allowed = require('../control_host_allowed');
const control_route_right = require('../helpers/control_route_right');
const control_same_origin = require('../control_same_origin');
const control_token_refusal = require('../helpers/control_token_refusal');
const control_token_status = require('../helpers/control_token_status');
const crypto = require('crypto');
const disks_serve = require('../../../../modules/disks/server/disks_serve');
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
const handle_control_tokens = require('./handle_control_tokens');
const health_from_views = require('../helpers/health_from_views');
const load_test_log_path = require('../helpers/load_test_log_path');
const load_test_run = require('../helpers/load_test_run');
const load_test_stop = require('../helpers/load_test_stop');
const load_test_url = require('../helpers/load_test_url');
const log_event = require('../helpers/log_event');
const log_within = require('../helpers/log_within');
const logline_compare = require('../helpers/logline_compare');
const logline_from_json = require('../helpers/logline_from_json');
const logline_place = require('../helpers/logline_place');
const logline_update = require('../helpers/logline_update');
const module_mount_of = require('../helpers/module_mount_of');
const module_route = require('../helpers/module_route');
const packages_serve = require('../../../../modules/packages/server/packages_serve');
const path = require('path');
const processes_serve = require('../../../../modules/processes/server/processes_serve');
const remote_call = require('../helpers/remote_call');
const remote_can = require('../helpers/remote_can');
const remote_containers_running = require('../helpers/remote_containers_running');
const remote_disk = require('../helpers/remote_disk');
const remote_removed_add = require('../helpers/remote_removed_add');
const remote_tags = require('../helpers/remote_tags');
const remote_update_call = require('../helpers/remote_update_call');
const render_error_page = require('../helpers/render_error_page');
const render_index_collection = require('../render_index_collection');
const render_sign_in_page = require('../helpers/render_sign_in_page');
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
const stream_open = require('../helpers/stream_open');
const stream_read = require('../helpers/stream_read');
const streams_of = require('../helpers/streams_of');
const term_create_refusal = require('../../../helpers/term_create_refusal');
const term_name_valid = require('../../../helpers/term_name_valid');
const terminal_serve = require('../../../../modules/terminal/server/terminal_serve');
const transfer_queue = require('../../../../modules/file_manager/server/transfer_queue');
const url_logged = require('../helpers/url_logged');
const view_from_forward = require('../helpers/view_from_forward');
const view_from_remote = require('../helpers/view_from_remote');
const view_from_service = require('../helpers/view_from_service');
const volumes_of_app = require('../helpers/volumes_of_app');
const volumes_serve = require('../../../../modules/volumes/server/volumes_serve');
const wants_html = require('../wants_html');

const BODY_LIMIT_BYTES = 1024*1024;

const RE_ACTION = /^\/api\/v1\/services\/([^/]+)\/(start|stop|restart|update|pull)$/;
const RE_REMOTE = /^\/api\/v1\/remotes\/([^/]+)$/;
const RE_REMOTE_SCREENSHOT = /^\/api\/v1\/remotes\/([^/]+)\/screenshot$/;
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
// The Processes, Disks and Packages modules' APIs, one machine's under each
const RE_REMOTE_PROCESSES = /^\/api\/v1\/remotes\/([^/]+)\/processes(\/.*)?$/;
const RE_STREAM = /^\/api\/v1\/streams\/([^/]+)$/;
const RE_REMOTE_TERMINALS = /^\/api\/v1\/remotes\/([^/]+)\/terminals(\/.*)?$/;
const RE_REMOTE_METRICS = /^\/api\/v1\/remotes\/([^/]+)\/metrics$/;
const RE_REMOTE_UPTIME = /^\/api\/v1\/remotes\/([^/]+)\/uptime$/;
const RE_REMOTE_PORTS = /^\/api\/v1\/remotes\/([^/]+)\/ports$/;
const RE_REMOTE_DISKS = /^\/api\/v1\/remotes\/([^/]+)\/disks(\/.*)?$/;
const RE_REMOTE_PACKAGES = /^\/api\/v1\/remotes\/([^/]+)\/packages(\/.*)?$/;
// ps and ss answer at once; the wait is for a machine thinking about it
const MACHINE_READ_TIMEOUT_MS = 15000;
const METRICS_RANGES = ['1h', '24h', '7d', '30d'];
const RE_REMOTE_AGENT = /^\/api\/v1\/remotes\/([^/]+)\/agent-update$/;
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
const PAGE_PANES = ['health', 'services', 'remotes', 'addresses', 'config', 'storage', 'secrets', 'tokens', 'networking', 'forwards', 'join', 'map', 'logline', 'authwall', 'load-tests'];
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
    processes: {name: 'processes', type: 'static', root: path.join(__dirname, '..', '..', '..', '..', 'modules', 'processes', 'ui'), fresh: true},
    disks: {name: 'disks', type: 'static', root: path.join(__dirname, '..', '..', '..', '..', 'modules', 'disks', 'ui'), fresh: true},
    packages: {name: 'packages', type: 'static', root: path.join(__dirname, '..', '..', '..', '..', 'modules', 'packages', 'ui'), fresh: true},
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
        if (control_owner_or_refuse(app, req, res) === false) {
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
    // Signing in is how a token is brought, so it is the one door open without one
    if (url.pathname === '/api/v1/session') {
        if (await handle_control_tokens(app, req, res, url) === false) {
            send_json(res, 405, {error: 'the session is opened with POST and closed with DELETE'});
        }
        return;
    }
    // Every other request brings a token. The owner's may do everything; an agent's may do what
    // its rights allow, of its own machines, and nothing else.
    const caller = control_caller(app, req);
    if (caller === null) {
        token_refuse(app, req, res, url);
        return;
    }
    if ((caller.owner === false) && (token_allowed(app, req, res, url, caller.token) === false)) {
        return;
    }
    // Every change asked of the control page is written down: what it was, and from where.
    // A HEAD asks, it changes nothing — a player probing a file is not a change. Nor is each
    // part of a file sent in parts: the file is written down once, when it is in.
    if ((req.method !== 'GET') && (req.method !== 'HEAD') && (RE_UPLOAD_PART.test(url.pathname) === false)) {
        log_event(app, 'control_change', {client: req.socket.remoteAddress, method: req.method, path: req.url});
    }
    if (url.pathname === '/api/v1/status') {
        send_json(res, 200, state_from_app(app));
        return;
    }
    if (await handle_control_tokens(app, req, res, url)) {
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
    if ((url.pathname === '/api/v1/modules') && (req.method === 'GET')) {
        modules_send(res);
        return;
    }
    if ((url.pathname === '/api/v1/streams') && (req.method === 'GET')) {
        streams_send(app, res, url.searchParams.get('base'));
        return;
    }
    const stream_asked = RE_STREAM.exec(url.pathname);
    if ((stream_asked !== null) && (req.method === 'GET')) {
        stream_send(app, res, stream_asked[1]);
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
    if ((url.pathname === '/api/v1/apt-upgrade') && (req.method === 'GET')) {
        handle_apt_all_read(app, res);
        return;
    }
    if ((url.pathname === '/api/v1/apt-upgrade') && (req.method === 'POST')) {
        await handle_apt_all(app, req, res);
        return;
    }
    if ((url.pathname === '/api/v1/apt-cancel') && (req.method === 'POST')) {
        await handle_apt_all_cancel(app, res);
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
    if ((url.pathname === '/api/v1/logline/place') && (req.method === 'GET')) {
        await logline_place_answer(app, res);
        return;
    }
    if ((url.pathname === '/api/v1/logline/update') && (req.method === 'POST')) {
        await logline_update_answer(app, res);
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
    // A module answers only what its manifest names; anything else is no door of it
    const mounted = module_mount_of(url.pathname);
    if ((mounted !== null) && (module_route(mounted.mount.manifest, req.method, mounted.tail) === null)) {
        send_json(res, 404, {error: `no such door: ${url.pathname}`});
        return;
    }
    const remote_docker = RE_REMOTE_DOCKER.exec(url.pathname);
    if (remote_docker !== null) {
        await handle_docker(app, req, res, decodeURIComponent(remote_docker[1]), (remote_docker[2] === undefined) ? '' : remote_docker[2]);
        return;
    }
    const remote_firewall = RE_REMOTE_FIREWALL.exec(url.pathname);
    if (remote_firewall !== null) {
        await handle_firewall(app, req, res, decodeURIComponent(remote_firewall[1]), (remote_firewall[2] === undefined) ? '' : remote_firewall[2]);
        return;
    }
    const remote_volumes = RE_REMOTE_VOLUMES.exec(url.pathname);
    if (remote_volumes !== null) {
        await handle_volumes(app, req, res, decodeURIComponent(remote_volumes[1]), (remote_volumes[2] === undefined) ? '' : remote_volumes[2]);
        return;
    }
    const transfers = RE_TRANSFERS.exec(url.pathname);
    if (transfers !== null) {
        await file_manager_transfers_serve(req, res, {queue: transfers_of(app), tail: (transfers[1] === undefined) ? '' : transfers[1], disk_known: v => (typeof v === 'string') && (app.remote_by_name[v] !== undefined)});
        return;
    }
    const remote_fs = RE_REMOTE_FS.exec(url.pathname);
    if (remote_fs !== null) {
        await handle_fs(app, req, res, decodeURIComponent(remote_fs[1]), (remote_fs[2] === undefined) ? '' : remote_fs[2]);
        return;
    }
    const remote_processes = RE_REMOTE_PROCESSES.exec(url.pathname);
    if (remote_processes !== null) {
        await handle_machine_module(app, req, res, decodeURIComponent(remote_processes[1]), ((remote_processes[2] === undefined) ? '' : remote_processes[2]), processes_serve, 'proc_list', 'the process list');
        return;
    }
    const remote_metrics = RE_REMOTE_METRICS.exec(url.pathname);
    if ((remote_metrics !== null) && (req.method === 'GET')) {
        await handle_remote_metrics(app, res, decodeURIComponent(remote_metrics[1]), url.searchParams.get('range'));
        return;
    }
    const remote_uptime = RE_REMOTE_UPTIME.exec(url.pathname);
    if ((remote_uptime !== null) && (req.method === 'GET')) {
        await handle_remote_uptime(app, res, decodeURIComponent(remote_uptime[1]), url.searchParams.get('days'));
        return;
    }
    const remote_terminals = RE_REMOTE_TERMINALS.exec(url.pathname);
    if (remote_terminals !== null) {
        await handle_terminals(app, req, res, decodeURIComponent(remote_terminals[1]), (remote_terminals[2] === undefined) ? '' : remote_terminals[2]);
        return;
    }
    const remote_ports = RE_REMOTE_PORTS.exec(url.pathname);
    if ((remote_ports !== null) && (req.method === 'GET')) {
        await handle_machine_read(app, res, decodeURIComponent(remote_ports[1]), 'port_list', 'the port list');
        return;
    }
    const remote_disks = RE_REMOTE_DISKS.exec(url.pathname);
    if (remote_disks !== null) {
        await handle_machine_module(app, req, res, decodeURIComponent(remote_disks[1]), ((remote_disks[2] === undefined) ? '' : remote_disks[2]), disks_serve, 'disk_list', 'the disk list');
        return;
    }
    const remote_packages = RE_REMOTE_PACKAGES.exec(url.pathname);
    if (remote_packages !== null) {
        await handle_packages(app, req, res, decodeURIComponent(remote_packages[1]), (remote_packages[2] === undefined) ? '' : remote_packages[2]);
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
        const named = (parts[1] === 'new') || (app.service_by_name[parts[1]] !== undefined);
        return named && ((parts[2] === undefined) || SERVICE_TABS.includes(parts[2]));
    }
    if (parts[0] === 'remotes') {
        const named = (parts[1] === 'new') || (app.remote_by_name[parts[1]] !== undefined);
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

// GET /api/v1/modules
// What every module holds and does, and where: its kinds of items, the commands on them, the
// doors that are neither, and the rights a token may be given of it. The manifests as they
// are, each with the base it is mounted at.
function modules_send(res)
{
    send_json(res, 200, {modules: module_mount_of.MODULE_MOUNTS.map(v => Object.assign({base: v.base}, v.manifest))});
}

// GET /api/v1/streams (query: base)
// The streams of lines kept now, running or ended a little while ago; with `base`, those of one
// module of one machine, which is how its page finds again what it was showing after a reload
function streams_send(app, res, base)
{
    const items = Array.from(streams_of(app).values()).filter(v => (v.kind === 'lines') && ((base === null) || (v.base === base)));
    send_json(res, 200, {items: items.map(v => ({id: v.id, url: v.url, title: v.title, base: v.base, command: v.command, item: v.item, started_at: v.started_at, ended_at: v.ended_at, state: v.state}))});
}

// GET /api/v1/streams/<id>
// One stream, from its first line kept, then as it goes; one that goes both ways is joined
// over a WebSocket at this address instead (handle_control_upgrade)
function stream_send(app, res, id)
{
    const stream = streams_of(app).get(id);
    if (stream === undefined) {
        send_json(res, 404, {error: `no stream ${id}: it ended over ten minutes ago, or serviceman restarted since`});
        return;
    }
    if (stream.kind === 'both') {
        send_json(res, 400, {error: 'this stream goes both ways: it is joined over a WebSocket at this address'});
        return;
    }
    stream_read(stream, res);
}

// GET /api/v1/remotes/<name>/ports
// What that machine is listening on, read when asked and kept nowhere: the agent runs ss over
// there as its own user, and what comes back is what that user may see.
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

// GET /api/v1/remotes/<name>/processes
// GET /api/v1/remotes/<name>/disks
// What is running on that machine and its disks, through the Processes and Disks modules: the
// doors are the module's, and its read is the agent running ps or df over there as its own
// user, so what comes back is what that user may see. The refusals are this host's own.
async function handle_machine_module(app, req, res, name, tail, serve, method, what)
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
    await serve(req, res, {
        read: () => remote_call(app, remote, method, {}, MACHINE_READ_TIMEOUT_MS),
        tail,
    });
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
    // An agent's token is kept within its folders by the machine's agent, which an older one cannot
    const token = req.control_token;
    if ((token !== undefined) && ((Array.isArray(token.folders) === false) || (token.folders.length === 0))) {
        send_json(res, 403, {error: `the token ${JSON.stringify(token.label)} names no folder for its files`});
        return;
    }
    if ((token !== undefined) && (remote_can(remote, 'fs_root') === false)) {
        send_json(res, 409, {error: `the agent on ${name} is from before a token is kept within its folder — its page says how it updates`});
        return;
    }
    await file_manager_serve(req, res, {
        disk: remote_disk(app, remote, (token === undefined) ? undefined : {root: token.folders}),
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
            tail: (files[2] === undefined) ? '' : files[2],
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
        stream: v => stream_open(app, {title: v, base: `/api/v1/remotes/${encodeURIComponent(remote.name)}/docker`}),
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
        ports: remote_can(remote, 'port_list') ? ports_read : undefined,
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
        key_safe: from_this_machine(req) || from_loopback_page(req) || (req.socket.encrypted === true),
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

// GET /api/v1/remotes/<name>/packages
// POST /api/v1/remotes/<name>/packages/upgrade
// GET /api/v1/remotes/<name>/packages/upgrade
// POST /api/v1/remotes/<name>/packages/cancel
// One machine's packages, through the Packages module: the list is read when asked, the agent
// running dpkg over there as its own user. Installing what waits, and stopping it again, are
// both by hand, from the machine's page; nothing here runs on a clock, and one that waits for
// its turn among several machines is started now when asked here. The run outlives the request
// by minutes, so it is kept on the remote's state and read back, even once the machine is gone.
async function handle_packages(app, req, res, name, tail)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    await packages_serve(req, res, {
        read: function () {
            machine_refuse(remote, 'package_list', 'the package list');
            return remote_call(app, remote, 'package_list', {}, MACHINE_READ_TIMEOUT_MS);
        },
        upgrade: function () {
            machine_refuse(remote, 'apt', 'installing updates');
            if (remote.state.apt.phase === 'running') {
                throw status_error(409, `an upgrade is already running on ${name}`);
            }
            apt_run(app, remote).catch(function (error) {
                log_event(app, 'apt_containers_error', {remote: remote.name, reason: error.message});
            });
            // The run is set before its first wait: its stream is known already
            return {started: true, stream: remote.state.apt.stream, url: remote.state.apt.url};
        },
        run: () => remote.state.apt,
        cancel: function () {
            machine_refuse(remote, 'apt', 'installing updates');
            return apt_cancel(app, remote);
        },
        tail,
    });
}

// A machine away, or with an agent from before what is asked, is refused with what to do
function machine_refuse(remote, method, what)
{
    if (remote.state.phase !== 'online') {
        throw status_error(409, `${remote.name} is not connected`);
    }
    if (remote_can(remote, method) === false) {
        throw status_error(400, `the agent on ${remote.name} is from before ${what} — its page says how it updates`);
    }
}

// GET /api/v1/apt-upgrade
// How the last upgrade of several machines at once is going: a row per machine, its last line
// rather than all of them, for a list read every second
function handle_apt_all_read(app, res)
{
    const batch = app.apt_all;
    if (batch === null) {
        send_json(res, 200, {batch: null});
        return;
    }
    const rows = [];
    for (const name of batch.remotes) {
        const remote = app.remote_by_name[name];
        if (remote === undefined) {
            continue;
        }
        const run = remote.state.apt;
        const updates = (remote.state.stats === null) ? null : (remote.state.stats.updates || null);
        rows.push({
            name,
            title: remote.title || name,
            phase: run.phase,
            lines: run.lines.length,
            last_line: (run.lines.length === 0) ? null : run.lines[run.lines.length - 1],
            error: run.error,
            containers: (run.containers === null) ? null : {started: run.containers.started, down: run.containers.down.map(v => v.name)},
            reboot: (updates !== null) && (updates.reboot === true),
        });
    }
    send_json(res, 200, {batch: {started_at: batch.started_at, ended_at: batch.ended_at, held: batch.held, remotes: rows}});
}

// POST /api/v1/apt-upgrade {"remotes": ["vps1", "vps2"]}
// Installs what is waiting on each machine named, at once, from the Remotes list. A machine
// that cannot be upgraded now is left out and said why; the rest start.
async function handle_apt_all(app, req, res)
{
    const body = JSON.parse((await body_read(req, BODY_LIMIT_BYTES)) || '{}');
    if ((Array.isArray(body.remotes) === false) || (body.remotes.length === 0) || body.remotes.some(v => typeof v !== 'string')) {
        send_json(res, 400, {error: 'remotes is a list of the machines to upgrade, by name'});
        return;
    }
    if ((app.apt_all !== null) && (app.apt_all.ended_at === null)) {
        send_json(res, 409, {error: 'machines are being upgraded already: cancel them, or wait for them to end'});
        return;
    }
    const remotes = [];
    const skipped = [];
    for (const name of new Set(body.remotes)) {
        const remote = app.remote_by_name[name];
        const reason = apt_refusal(remote, name);
        if (reason === null) {
            remotes.push(remote);
        }
        else {
            skipped.push({name, reason});
        }
    }
    if (remotes.length === 0) {
        send_json(res, 409, {error: 'none of these machines can be upgraded now', skipped});
        return;
    }
    const held = await own_remote(app, remotes);
    apt_all_run(app, remotes, held).catch(function (error) {
        log_event(app, 'apt_all_error', {reason: error.message});
    });
    send_json(res, 202, {started: remotes.map(v => v.name), held: (held === null) ? null : held.name, skipped});
}

// POST /api/v1/apt-cancel
// Stops every run of the last upgrade of several machines that is still going; one that waits
// for its turn does not start
async function handle_apt_all_cancel(app, res)
{
    const batch = app.apt_all;
    const stopped = [];
    if (batch !== null) {
        for (const name of batch.remotes) {
            const remote = app.remote_by_name[name];
            if (remote === undefined) {
                continue;
            }
            try {
                if ((await apt_cancel(app, remote)).stopped) {
                    stopped.push(name);
                }
            }
            catch (error) {
                log_event(app, 'apt_cancel_error', {remote: name, reason: error.message});
            }
        }
    }
    send_json(res, 200, {stopped});
}

// Why a machine cannot be upgraded now, or null when it can
function apt_refusal(remote, name)
{
    if (remote === undefined) {
        return `no remote named ${JSON.stringify(name)}`;
    }
    if (remote.state.phase !== 'online') {
        return `${name} is not connected`;
    }
    if (remote_can(remote, 'apt') === false) {
        return `the agent on ${name} is from before installing updates — its page says how it updates`;
    }
    if ((remote.state.apt.phase === 'running') || (remote.state.apt.phase === 'waiting')) {
        return `an upgrade is already running on ${name}`;
    }
    return null;
}

// The machine whose Docker runs this serviceman, among these; null when serviceman runs in no
// container, or on none of them
async function own_remote(app, remotes)
{
    if (app.own_container === null) {
        return null;
    }
    const lists = await Promise.all(remotes.map(v => remote_containers_running(app, v).catch(() => null)));
    const index = lists.findIndex(v => (v !== null) && v.some(vv => vv.id === app.own_container));
    return (index === -1) ? null : remotes[index];
}

// A run that goes is stopped on its machine; one that waits for its turn is not started
async function apt_cancel(app, remote)
{
    const run = remote.state.apt;
    if (run.phase === 'waiting') {
        Object.assign(run, {phase: 'cancelled', ended_at: Date.now()});
        return {stopped: true};
    }
    if (run.phase !== 'running') {
        return {stopped: false, reason: 'nothing is being installed on this machine'};
    }
    return remote_call(app, remote, 'apt_cancel', {});
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

// GET /api/v1/remotes/<name>/uptime?days=30
// The machine's uptime by day, counted by its agent from servermon's lines: for each day, how
// long was known and how long of it the machine was down, with the stretches. The last answer is
// kept here and shown while the machine is away, with `away: true`, as the charts are.
async function handle_remote_uptime(app, res, name, days_text)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    const days = (days_text === null) ? 30 : Number(days_text);
    if ((Number.isInteger(days) === false) || (days < 1) || (days > 90)) {
        send_json(res, 400, {error: 'days is a whole number from 1 to 90'});
        return;
    }
    const kept = remote.state.uptime;
    if (remote.state.phase !== 'online') {
        if (kept === null) {
            send_json(res, 409, {error: `${name} is not connected, and its uptime is counted on it`});
            return;
        }
        send_json(res, 200, Object.assign({}, kept, {away: true}));
        return;
    }
    if (remote_can(remote, 'uptime') === false) {
        send_json(res, 400, {error: `the agent on ${name} is from before uptime: an update to 1.22 or newer brings it`, old_agent: true});
        return;
    }
    try {
        const answer = await remote_call(app, remote, 'uptime', {days}, MACHINE_READ_TIMEOUT_MS);
        remote.state.uptime = answer;
        send_json(res, 200, Object.assign({}, answer, {away: false}));
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

// GET /api/v1/remotes/<name>/terminals
// POST /api/v1/remotes/<name>/terminals (body: {name, cols, rows, env, cwd})
// POST /api/v1/remotes/<name>/terminals/<term>/signal (body: {signal, to})
// POST /api/v1/remotes/<name>/terminals/<term>/end
// One machine's kept terminals, through the Terminal module: the doors are the module's, the
// machine is asked over the link its agent dialled. A new one is the name asked for, or the
// lowest number no terminal has; its shell gets the variables of `env` and starts in `cwd`,
// and the answer is {name, created}, created false when it was running already. The list is
// read when asked and kept nowhere: the agent reads its terminals' notes as its own user.
async function handle_terminals(app, req, res, name, tail)
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
    await terminal_serve(req, res, {
        call: (method, params) => terminal_call(app, remote, method, params),
        join: v => terminal_join(app, req, remote, v),
        tail,
    });
}

// What the Terminal module asks of the machine, with this host's refusals: an agent from before
// what is asked, a name or an env it would not take
async function terminal_call(app, remote, method, params)
{
    if (method === 'term_list') {
        if (remote_can(remote, 'term_list') === false) {
            throw status_error(400, `the agent on ${remote.name} is from before kept terminals — its page says how it updates`);
        }
        return await remote_call(app, remote, method, params, MACHINE_READ_TIMEOUT_MS);
    }
    if ((remote_can(remote, 'term_list') === false) || ((method !== 'term_end') && (remote_can(remote, 'term_signal') === false))) {
        throw status_error(400, `the agent on ${remote.name} is from before ${(method === 'term_end') ? 'kept terminals' : 'creating and signalling terminals'} — its page says how it updates`);
    }
    const refused = (method === 'term_create') ? term_create_refusal(params.env, params.cwd) : null;
    if (refused !== null) {
        throw status_error(400, refused);
    }
    // An empty env or folder is none: the shell's own
    const asked = (method === 'term_create') ? Object.assign({}, params, {env: params.env || undefined, cwd: params.cwd || undefined}) : params;
    // An older agent would start the shell without them, and answer as if it had not
    if (((asked.env !== undefined) || (asked.cwd !== undefined)) && (remote_can(remote, 'term_env') === false)) {
        throw status_error(400, `the agent on ${remote.name} is from before env and cwd for a new terminal — its page says how it updates`);
    }
    if (term_name_valid(asked.name) === false) {
        throw status_error(400, `a terminal name is letters, digits, - and _, at most 64 of them: ${JSON.stringify(asked.name)}`);
    }
    let answer;
    try {
        answer = await remote_call(app, remote, method, asked, MACHINE_READ_TIMEOUT_MS);
    }
    catch (error) {
        throw status_error(400, error.message);
    }
    log_event(app, 'terminal_call', {remote: remote.name, method, term: asked.name});
    return answer;
}

// Joining a terminal is a stream that goes both ways: made here, and joined once, within a
// minute, by a WebSocket at its address (handle_control_upgrade), by whoever asked for it
function terminal_join(app, req, remote, name)
{
    if ((remote_can(remote, 'term_list') === false) || (remote_can(remote, 'term_signal') === false)) {
        throw status_error(400, `the agent on ${remote.name} is from before kept terminals — its page says how it updates`);
    }
    if (term_name_valid(name) === false) {
        throw status_error(400, `a terminal name is letters, digits, - and _, at most 64 of them: ${JSON.stringify(name)}`);
    }
    const token = req.control_token;
    const stream = stream_open(app, {
        title: `the terminal ${name} on ${remote.name}`,
        base: `/api/v1/remotes/${encodeURIComponent(remote.name)}/terminals`,
        command: 'join',
        item: name,
        token: (token === undefined) ? null : token.id,
        join: {remote: remote.name, term: name},
    });
    return {stream: stream.id, url: stream.url};
}

function status_error(status, message)
{
    const out = new Error(message);
    out.status = status;
    return out;
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
    const admin = (app.config.logline === null) ? 'logline' : app.config.logline.admin;
    if (endpoint !== '') {
        // A wrong address is refused before the token is kept, so nothing lands half-way
        try {
            logline_from_json({endpoint, admin, ui: (ui === '') ? undefined : ui}, 'logline');
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
    let value = ((body.value === undefined) || (body.value === null)) ? '' : String(body.value);
    if ((body.copy_from !== undefined) && (body.copy_from !== null) && (body.copy_from !== '')) {
        const from = kept.global[String(body.copy_from)];
        if (from === undefined) {
            send_json(res, 404, {error: `nothing is kept under ${body.copy_from}`});
            return;
        }
        value = from;
    }
    const bag = (service === '') ? kept.global : ((kept.services[service] === undefined) ? {} : kept.services[service]);
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
    log_event(app, (value === '') ? 'secret_removed' : 'secret_written', {service: (service === '') ? null : service, secret: name});
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
    const port = (app.listen_port === 80) ? '' : String(app.listen_port);
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
    const asked = (remote_name === null) ? '' : remote_name;
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
    const join = ((body.join === undefined) || (body.join === null)) ? null : object_from_body(body, 'join');
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
            found.log_dirs = json.dirs.map(v => ((v.service === undefined) || (v.service === null) || (v.service === '')) ? {path: v.path} : {path: v.path, service: v.service});
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
        const said = (typeof miss === 'string') ? {error: miss, status: miss_status} : miss;
        send_json(res, said.status || miss_status || 400, Object.assign({error: said.error}, (said.services === undefined) ? {} : {services: said.services}));
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

// No token, or one nobody holds: a browser gets the page that asks for the owner's, anything
// else a 401 that says what is wanted
function token_refuse(app, req, res, url)
{
    log_event(app, 'control_token_refused', {client: req.socket.remoteAddress, method: req.method, path: url_logged(req.url), reason: (req.headers.authorization === undefined) && (req.headers.cookie === undefined) ? 'no_token' : 'unknown_token'});
    if (wants_html(req) && (url.pathname.startsWith('/api/') === false)) {
        render_sign_in_page(res);
        return;
    }
    send_json(res, 401, {error: 'the control door wants a token: Authorization: Bearer <token>'});
}

// An agent's token goes on only with one of its rights, on one of its machines; otherwise it
// gets a 403 that says which right was missing. The status it gets is its own, cut down to its
// machines, and answered here.
function token_allowed(app, req, res, url, token)
{
    const right = control_route_right(req.method, url.pathname);
    const refused = control_token_refusal(right, token);
    if (refused !== null) {
        log_event(app, 'control_token_refused', {client: req.socket.remoteAddress, token: token.label, method: req.method, path: url_logged(req.url), reason: refused});
        send_json(res, 403, {error: `the token ${JSON.stringify(token.label)} ${refused}`});
        return false;
    }
    token.used_at = new Date().toISOString();
    // The routes it goes on to keep it within what it may: the file manager within its folder
    req.control_token = token;
    // A token let in asks serviceman's own API, whose query is a folder or a machine, never a
    // secret: the line keeps it, since what was read is what the line is for
    log_event(app, 'control_token_used', {token: token.label, method: req.method, path: req.url});
    if (right.right === 'status') {
        send_json(res, 200, control_token_status(app, token));
        return false;
    }
    return true;
}

// A machine's files under their own address are the owner's: the page's cookie is sent there
function control_owner_or_refuse(app, req, res)
{
    const caller = control_caller(app, req);
    if ((caller !== null) && caller.owner) {
        return true;
    }
    log_event(app, 'control_token_refused', {client: req.socket.remoteAddress, method: req.method, path: url_logged(req.url), reason: (caller === null) ? 'no_token' : 'not_the_owner'});
    render_error_page(res, (caller === null) ? 401 : 403, 'Sign in first', 'Open the control page and sign in with the owner\'s token');
    return false;
}

// GET /api/v1/logline/place
// Where Logline runs, and which of its files there are not the ones this serviceman carries;
// what keeps it from being found, said as the error
async function logline_place_answer(app, res)
{
    let place;
    let files;
    try {
        place = await logline_place(app);
        files = await logline_compare(app, place);
    }
    catch (error) {
        send_json(res, 409, {error: error.message});
        return;
    }
    send_json(res, 200, {
        remote: place.remote.name,
        project: place.project,
        dir: place.dir,
        files: files.map(v => ({path: v.path, state: v.state})),
        differs: files.filter(v => v.state !== 'same').length,
    });
}

// POST /api/v1/logline/update
// Logline on its machine made the same as here, answered as it goes: one JSON object a line,
// {step, steps, name, text} or {text}, and last {end: done | failed, said}, as the Docker
// module's long actions answer
async function logline_update_answer(app, res)
{
    res.writeHead(200, {'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
    log_event(app, 'logline_update_begin', {});
    try {
        const done = await logline_update(app, function (value) {
            res.write(`${JSON.stringify(value)}\n`);
        });
        res.end(`${JSON.stringify({end: 'done', said: done.said})}\n`);
    }
    catch (error) {
        log_event(app, 'logline_update_error', {reason: error.message});
        res.end(`${JSON.stringify({end: 'failed', said: error.message})}\n`);
    }
}

// One problem as the page shows it: since when it is known, the moment it began where that is
// known and the moment it was first seen where not
function view_from_problem(problem)
{
    return {
        key: problem.key,
        kind: problem.kind,
        remote: problem.remote,
        service: (problem.service === undefined) ? null : problem.service,
        subject: problem.subject,
        cause: problem.cause,
        fix: problem.fix,
        since: (problem.since === null) ? problem.first_seen : problem.since,
    };
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
    const logline = (app.config.logline === null) ? null : {
        endpoint: app.config.logline.endpoint,
        ui: app.config.logline.ui,
        admin: app.config.logline.admin,
        admin_kept: secrets_read(app).global[app.config.logline.admin] !== undefined,
    };
    const problems = Array.from(app.problems.values()).filter(v => v.shown).map(view_from_problem).sort((a, b) => (a.since - b.since));
    const forwards = app.config.forwards.map(v => view_from_forward(app, v));
    const agent_built = agent_bundle.built_at();
    return {
        now,
        started_at: app.started_at,
        // The agent this host serves: a machine running an older one is a machine to update
        agent_built,
        listen: app.config.listen,
        control: app.config.control,
        // Whether a machine may add itself, and what it may claim — never the token itself
        join: (app.config.join === null) ? null : {tags_allowed: app.config.join.tags_allowed, name_prefix: app.config.join.name_prefix},
        // Where Logline is, and whether its admin token is kept — never the token itself
        logline,
        services,
        remotes,
        // What is wrong now, the oldest first: what the last check found and has seen twice
        problems,
        // How everything is, the good with the bad: the Health page
        health: health_from_views({now, agent_built, logline, services, remotes, forwards, problems}, app.health_seen),
        forwards,
        // Where a forward that shows up on serviceman itself puts its socket file
        state_dir: app.state_dir,
        // What k6 is sent at, each with the address it asks, and the runs so far, oldest first
        load_tests: app.config.load_tests.map(v => Object.assign({}, v, {url_asked: load_test_url(app, v)})),
        // A run's lines are its log, asked for when opened; one going shows its last few
        load_test_runs: app.load_test_runs.map(v => Object.assign({}, v, {lines: (v.ended_at === null) ? v.lines.slice(-40) : []})),
    };
}

module.exports = handle_control_request;
