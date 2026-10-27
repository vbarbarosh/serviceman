const format_duration_ms = require('../../../helpers/format_duration_ms');
const updates_check = require('./updates_check');

// Below these a machine is short of room, and below the second it is about to stop working
const DISK_LOW = 0.10;
const DISK_OUT = 0.03;
const MEM_LOW = 0.05;
const CPU_BUSY = 0.90;
const STORE_QUIET_MS = 10*60*1000;

// How everything is, one row per thing and one check per thing it does: the machines and their
// agents, disks, updates, Docker and firewall; the services and whether they answer; Logline
// and each machine's lines; the forwards. Built from the views the page gets anyway, the last
// minute's asks (`seen`, problems_check) and what is wrong (`problems`), so a check says the
// same as the Problems bar. A check is ok, warn (works, but look), bad (does not work) or none
// (nothing to say: not set up, not asked yet, not this agent's).
//
//     views   {now, agent_built, logline, services, remotes, forwards, problems, security}, as
//             state_from_app
//     seen    {checked_at, items: Map(key => {state, text, detail})}
function health_from_views(views, seen)
{
    const problems = new Map(views.problems.map(v => [v.key, v]));
    const areas = [
        {key: 'machines', title: 'Machines', rows: views.remotes.map(v => machine_row(v, views, seen, problems))},
        {key: 'services', title: 'Services', rows: views.services.map(v => service_row(v, seen, problems))},
        {key: 'logline', title: 'Logline', rows: [logline_row(views, seen)]},
        {key: 'lines', title: 'Lines per machine', rows: lines_rows(views, problems)},
        {key: 'forwards', title: 'Forwards', rows: views.forwards.map(forward_row)},
    ];
    const counts = {bad: 0, warn: 0, none: 0, ok: 0};
    for (const area of areas) {
        for (const row of area.rows) {
            counts[row.state]++;
        }
    }
    return {checked_at: seen.checked_at, counts, areas};
}

function machine_row(remote, views, seen, problems)
{
    const name = remote.name;
    const checks = [link_check(remote, views.now, problems)];
    const machine = remote.machine;
    if ((remote.phase === 'online') && (machine !== null)) {
        checks.push(agent_check(remote, views.agent_built));
        checks.push(disk_check(machine));
        checks.push(mem_check(machine));
        checks.push(cpu_check(machine));
        checks.push(servermon_check(machine));
        checks.push(updates_check(machine.updates, views.now));
        checks.push(docker_check(name, machine, seen, problems));
        checks.push(seen_check('firewall', 'Firewall', `firewall:${name}`, seen));
        if (remote.doors !== null) {
            checks.push(doors_check(remote.doors));
        }
        if (views.security !== undefined) {
            checks.push(security_check_of(name, views.security));
        }
    }
    return row(`remote:${name}`, remote.title || name, {remote: name}, checks.filter(v => v !== null));
}

function link_check(remote, now, problems)
{
    const problem = problems.get(`remote_offline:${remote.name}`);
    if (problem !== undefined) {
        return from_problem('link', 'Link', problem, `offline for ${format_duration_ms(now - problem.since)}`);
    }
    if (remote.phase === 'online') {
        const latency = (remote.latency_ms === null) ? '' : `, ${Math.round(remote.latency_ms)} ms`;
        return check('link', 'Link', 'ok', `online${latency}`, (remote.uptime_ms === null) ? null : `connected for ${format_duration_ms(remote.uptime_ms)}`);
    }
    if (remote.phase === 'greeting') {
        return check('link', 'Link', 'none', 'saying hello', null);
    }
    if (remote.left_at === null) {
        return check('link', 'Link', 'none', 'not since serviceman started', 'Its agent has not connected since serviceman started.');
    }
    return check('link', 'Link', 'bad', `offline for ${format_duration_ms(now - remote.left_at)}`, remote.error);
}

function agent_check(remote, served)
{
    const version = (remote.agent_version === null) ? 'older' : remote.agent_version;
    if (remote.update_refused !== null) {
        return check('agent', 'Agent', 'warn', `${version}, will not update`, remote.update_refused);
    }
    if ((served === null) || (remote.agent_built === served)) {
        return check('agent', 'Agent', 'ok', version, 'The agent this serviceman serves.');
    }
    return check('agent', 'Agent', 'warn', `${version}, updating`, 'Older than the agent this serviceman serves; it is asked to update.');
}

function disk_check(machine)
{
    const disk = machine.disk;
    if (!Number.isFinite(disk.total) || (disk.total <= 0) || !Number.isFinite(disk.free)) {
        return null;
    }
    const part = disk.free/disk.total;
    const state = (part < DISK_OUT) ? 'bad' : ((part < DISK_LOW) ? 'warn' : 'ok');
    return check('disk', 'Disk', state, `${gb(disk.free)} free`, `${gb(disk.free)} free of ${gb(disk.total)} on ${disk.path} (${Math.round(part*100)}%)`);
}

function mem_check(machine)
{
    const mem = machine.mem;
    if (!Number.isFinite(mem.total) || (mem.total <= 0) || !Number.isFinite(mem.free)) {
        return null;
    }
    const part = mem.free/mem.total;
    return check('memory', 'Memory', (part < MEM_LOW) ? 'warn' : 'ok', `${gb(mem.free)} free`, `${gb(mem.free)} free of ${gb(mem.total)} (${Math.round(part*100)}%)`);
}

function cpu_check(machine)
{
    if (!Number.isFinite(machine.cpu_busy)) {
        return null;
    }
    const load = Number.isFinite(machine.load) ? `, load ${machine.load.toFixed(2)}` : '';
    return check('cpu', 'CPU', (machine.cpu_busy >= CPU_BUSY) ? 'warn' : 'ok', `${Math.round(machine.cpu_busy*100)}% busy`, `${Math.round(machine.cpu_busy*100)}% busy${load}`);
}

// The numbers above are servermon's: a silent one is a machine whose numbers are not known
function servermon_check(machine)
{
    const servermon = machine.servermon;
    if ((servermon === null) || (servermon === undefined)) {
        return null;
    }
    if (servermon.state === 'running') {
        return check('servermon', 'servermon', 'ok', 'a line a second', null);
    }
    if (servermon.state === 'off') {
        return check('servermon', 'servermon', 'warn', 'off', 'The agent keeps no log folder (SERVICEMAN_LOG_DIR), so servermon does not run and the machine\'s numbers are not known.');
    }
    const since = (servermon.last_at === null) ? 'has written nothing yet' : `silent since ${servermon.last_at.replace('T', ' ').slice(0, 19)}`;
    return check('servermon', 'servermon', 'warn', since, `servermon ${since}: the machine's numbers are not known. The agent starts it again within a minute.`);
}

// What Docker on the machine holds, as the last look found it; what is wrong with a container
// is the problem said in its words
function docker_check(name, machine, seen, problems)
{
    const wrong = Array.from(problems.values()).filter(v => (v.kind === 'container') && (v.remote === name));
    if (wrong.length > 0) {
        const text = (wrong.length === 1) ? wrong[0].subject.replace(` on ${name}`, '') : `${wrong.length} containers in trouble`;
        return check('docker', 'Docker', 'bad', text, wrong.map(v => `${v.subject}: ${v.cause}. ${v.fix}`).join('\n'));
    }
    if (machine.docker === null) {
        return null;
    }
    return seen_check('docker', 'Docker', `docker:${name}`, seen);
}

// What the Security page found on the machine, counted: what to mend, what to look at. Said
// here, not counted as a problem: an open port is a choice to look at, not a thing broken.
function security_check_of(name, security)
{
    const row = security.rows.find(v => v.remote === name);
    if (row === undefined) {
        return check('security', 'Security', 'none', 'not looked at yet', null);
    }
    if (row.at === null) {
        return check('security', 'Security', 'none', row.checking ? 'looking now' : 'not looked at yet', null);
    }
    if (row.error !== null) {
        return check('security', 'Security', 'none', 'not looked at', row.error);
    }
    const bad = row.checks.filter(v => v.state === 'bad');
    const warn = row.checks.filter(v => v.state === 'warn');
    const said = bad.concat(warn).map(v => `${v.label}: ${v.text}`).join('\n');
    if (bad.length > 0) {
        return check('security', 'Security', 'warn', `${bad.length} to mend`, said);
    }
    if (warn.length > 0) {
        return check('security', 'Security', 'warn', `${warn.length} to look at`, said);
    }
    return check('security', 'Security', 'ok', 'nothing found', null);
}

function doors_check(doors)
{
    if (doors.error !== null) {
        return check('doors', 'Doors', 'bad', 'not taken', doors.error);
    }
    if ((doors.wanted !== null) && (doors.told !== doors.wanted)) {
        return check('doors', 'Doors', 'none', 'being told', 'Its door table is on its way to it.');
    }
    return check('doors', 'Doors', 'ok', 'up to date', null);
}

function service_row(service, seen, problems)
{
    const checks = [phase_check(service)];
    for (const instance of service.instances) {
        if (instance.phase !== 'running') {
            continue;
        }
        const where = (instance.remote === null) ? '' : ` on ${instance.remote}`;
        const key = `answers:${instance.slot}`;
        const problem = problems.get(`service_silent:${service.name}:${instance.slot}`);
        if (problem !== undefined) {
            checks.push(from_problem(key, 'Answers', problem, (instance.remote === null) ? 'no' : `not${where}`));
            continue;
        }
        const answer = seen_check(key, 'Answers', `service:${service.name}:${instance.slot}`, seen);
        checks.push((answer.state === 'none') ? answer : Object.assign(answer, {text: `${answer.text}${where}`}));
    }
    return row(`service:${service.name}`, service.title || service.name, {service: service.name}, checks);
}

// A service that is stopped is asleep, not broken: it starts on the next visit. Grey, as on its
// own page: green is a running one
function phase_check(service)
{
    const phase = service.phase;
    if (service.gave_up) {
        return check('phase', 'State', 'bad', 'gave up starting', service.error);
    }
    if ((phase === 'failed') || (phase === 'lost')) {
        return check('phase', 'State', 'bad', (phase === 'lost') ? 'its machine went' : 'failed', service.error);
    }
    if (phase === 'running') {
        const up = (service.uptime_ms === null) ? '' : ` for ${format_duration_ms(service.uptime_ms)}`;
        return check('phase', 'State', 'ok', `running${up}`, null);
    }
    if (phase === 'stopped') {
        return check('phase', 'State', 'none', 'asleep', (service.type === 'external') ? null : 'Starts on the next visit.');
    }
    return check('phase', 'State', 'none', phase, null);
}

// Logline itself: whether it takes lines, said by what the machines hear back from it (its
// endpoint is their way in, a name serviceman may not resolve), and its viewer, asked as a
// visitor would
function logline_row(views, seen)
{
    if (views.logline === null) {
        return row('logline', 'Logline', {}, [check('store', 'Store', 'none', 'not set up', 'serviceman sends nobody\'s lines anywhere: the config has no logline.')]);
    }
    const checks = [store_check(views)];
    if (views.logline.ui !== null) {
        checks.push(seen_check('viewer', 'Viewer', 'logline:ui', seen));
    }
    checks.push(views.logline.admin_kept ? check('admin', 'Admin token', 'ok', 'kept', null) : check('admin', 'Admin token', 'warn', 'not kept', 'Machines get no Logline token without it: Logline\'s page, Admin token.'));
    return row('logline', 'Logline', {}, checks);
}

// Logline takes lines when a machine had them taken lately; it refuses when every machine that
// sends is refused
function store_check(views)
{
    const sending = views.remotes.filter(v => (v.phase === 'online') && (v.logline.status !== null) && (v.logline.status.collecting === true));
    const taken = sending.filter(v => (v.logline.status.last_answer === 'ok') && (v.logline.status.last_sent_at !== null) && (views.now - Date.parse(v.logline.status.last_sent_at) < STORE_QUIET_MS));
    if (taken.length > 0) {
        const last = Math.min(...taken.map(v => views.now - Date.parse(v.logline.status.last_sent_at)));
        return check('store', 'Store', 'ok', `takes lines, last ${format_duration_ms(last)} ago`, `${taken.length} of ${sending.length} ${plural(sending.length, 'machine', 'machines')} had their lines taken in the last ${STORE_QUIET_MS/60000} minutes`);
    }
    const refused = sending.filter(v => (v.logline.status.last_answer !== null) && (v.logline.status.last_answer !== 'ok'));
    if ((refused.length > 0) && (refused.length === sending.length)) {
        return check('store', 'Store', 'bad', 'refuses every machine', refused.map(v => `${v.name}: ${v.logline.status.last_answer}`).join('\n'));
    }
    return check('store', 'Store', 'none', 'nothing sent lately', 'No machine had lines taken in the last 10 minutes.');
}

// Each machine's lines on their way to Logline
function lines_rows(views, problems)
{
    const out = [];
    for (const remote of views.remotes) {
        if (remote.logline.logs === 'off') {
            continue;
        }
        out.push(row(`logs:${remote.name}`, remote.title || remote.name, {remote: remote.name}, lines_checks(remote, views.now, problems)));
    }
    return out;
}

function lines_checks(remote, now, problems)
{
    const name = remote.name;
    const status = remote.logline.status;
    if (remote.phase !== 'online') {
        return [check('sending', 'Sending', 'none', 'machine offline', 'Its lines wait on the machine until it is back.')];
    }
    if ((status === null) || (status.collecting !== true)) {
        const why = (remote.logline.error !== null) ? remote.logline.error : 'Its agent does not collect: too old, or not told yet.';
        return [check('sending', 'Sending', (remote.logline.error !== null) ? 'bad' : 'none', 'not collecting', why)];
    }
    const out = [];
    const refused = problems.get(`logline_refused:${name}`) || problems.get(`logline_silent:${name}`);
    if (refused !== undefined) {
        out.push(from_problem('sending', 'Sending', refused, refused.key.startsWith('logline_refused:') ? 'refused' : 'stuck'));
    }
    else if ((status.last_answer !== null) && (status.last_answer !== 'ok')) {
        out.push(check('sending', 'Sending', 'bad', 'refused', `Logline answers "${status.last_answer}"`));
    }
    else {
        const last = (status.last_sent_at === null) ? 'nothing sent yet' : `last ${format_duration_ms(now - Date.parse(status.last_sent_at))} ago`;
        out.push(check('sending', 'Sending', 'ok', last, `${status.sent.lines.toLocaleString('en-US')} lines sent since the agent started`));
    }
    const full = problems.get(`logline_full:${name}`);
    if (full !== undefined) {
        const lines = status.waiting.lines;
        out.push(Object.assign(from_problem('waiting', 'Waiting', full, `${lines.toLocaleString('en-US')} ${plural(lines, 'line', 'lines')}, near the limit`), {state: 'warn'}));
    }
    else {
        const lines = status.waiting.lines;
        out.push(check('waiting', 'Waiting', 'ok', (lines === 0) ? 'nothing' : `${lines.toLocaleString('en-US')} ${plural(lines, 'line', 'lines')}`, Number.isFinite(status.cap_bytes) ? `${mb(status.waiting.bytes)} of ${mb(status.cap_bytes)} kept on the machine` : null));
    }
    const dirs = Object.keys(status.dir_errors || {});
    if (dirs.length > 0) {
        out.push(check('folders', 'Folders', 'warn', `${dirs.length} not read`, dirs.map(v => `${v}: ${status.dir_errors[v]}`).join('\n')));
    }
    return out;
}

function forward_row(forward)
{
    const state = (forward.state === 'ready') ? 'ok' : (['aside', 'telling'].includes(forward.state) ? 'none' : 'bad');
    const text = (forward.state === 'ready') ? 'ready' : forward.state.replace(/_/g, ' ');
    return row(`forward:${forward.label}`, forward.label, {}, [check('state', 'State', state, text, forward.problem)]);
}

// What one of the minute's asks found; not asked yet is nothing to say
function seen_check(key, label, seen_key, seen)
{
    const item = seen.items.get(seen_key);
    if (item === undefined) {
        return check(key, label, 'none', 'not asked yet', null);
    }
    return check(key, label, item.state, item.text, item.detail);
}

// A check in the words of what is wrong there: its own short text, the problem's whole say
function from_problem(key, label, problem, text)
{
    return check(key, label, 'bad', (text === undefined) ? problem.subject : text, `${problem.subject}: ${problem.cause}. ${problem.fix}`);
}

function check(key, label, state, text, detail)
{
    return {key, label, state, text, detail: (detail === undefined) ? null : detail};
}

// A row is as well as its worst check; one with nothing but nothing to say says nothing
function row(key, name, where, checks)
{
    const states = checks.map(v => v.state);
    const state = ['bad', 'warn', 'ok'].find(v => states.includes(v)) || 'none';
    return {key, name, remote: (where.remote === undefined) ? null : where.remote, service: (where.service === undefined) ? null : where.service, state, checks};
}

function gb(bytes)
{
    return (bytes >= 1024**3) ? `${(bytes/1024**3).toFixed(1)} GB` : `${Math.round(bytes/1024**2)} MB`;
}

function mb(bytes)
{
    return `${Math.round(bytes/1024/1024).toLocaleString('en-US')} MB`;
}

function plural(n, one, many)
{
    return (n === 1) ? one : many;
}

module.exports = health_from_views;
