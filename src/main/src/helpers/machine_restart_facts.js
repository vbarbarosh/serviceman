const docker_exec_connect = require('./docker_exec_connect');
const engine_json = require('./engine_json');
const remote_call = require('./remote_call');
const remote_can = require('./remote_can');

const READ_TIMEOUT_MS = 15000;
// The policies Docker starts a container again by when its daemon starts, as after a restart
const BACK = ['always', 'unless-stopped'];
// The days of uptime looked back over for the machine's last restart
const UPTIME_DAYS = 90;

// What a restart of one machine would touch, for the window that asks before it: whether
// serviceman itself runs there; its running containers, by what starts each again; its kept
// terminals, which end; and how long its last restart kept it away, as its agent's uptime
// counts it. A part that cannot be read is null, and `errors` says why; none holds up the rest.
//
//     out   {serviceman_here, containers, terminals, last, errors}
//           containers   {back, serviceman, maybe, stay}, names each: Docker's policy starts it
//                        again; serviceman does (its service's); on-failure, only if it ended
//                        with an error; nothing does. Or null.
//           terminals    how many are kept there, or null
//           last         {at, down_ms}: when the last restart ended and how long it was away;
//                        null where none was counted
async function machine_restart_facts(app, remote)
{
    const errors = {containers: null, terminals: null, last: null};
    const [containers, terminals, last] = await Promise.all([
        containers_of(app, remote).catch(function (error) {
            errors.containers = error.message;
            return null;
        }),
        terminals_of(app, remote).catch(function (error) {
            errors.terminals = error.message;
            return null;
        }),
        last_of(app, remote).catch(function (error) {
            errors.last = error.message;
            return null;
        }),
    ]);
    const serviceman_here = (containers !== null) && (app.own_container !== null) && containers.ids.includes(app.own_container);
    return {serviceman_here, containers: (containers === null) ? null : containers.by, terminals, last, errors};
}

async function containers_of(app, remote)
{
    const connect = docker_exec_connect(app, remote);
    const list = await engine_json(connect, 'GET', '/containers/json');
    const full = await Promise.all(list.map(v => engine_json(connect, 'GET', `/containers/${v.Id}/json`)));
    const by = {back: [], serviceman: [], maybe: [], stay: []};
    for (const item of full) {
        const name = String(item.Name || item.Id).replace(/^\//, '');
        const labels = ((item.Config === undefined) || (item.Config.Labels === null) || (item.Config.Labels === undefined)) ? {} : item.Config.Labels;
        const policy = ((item.HostConfig === undefined) || (item.HostConfig.RestartPolicy === undefined)) ? '' : item.HostConfig.RestartPolicy.Name;
        if (BACK.includes(policy)) {
            by.back.push(name);
        }
        else if (typeof labels['serviceman.service'] === 'string') {
            by.serviceman.push(name);
        }
        else if (policy === 'on-failure') {
            by.maybe.push(name);
        }
        else {
            by.stay.push(name);
        }
    }
    for (const key of Object.keys(by)) {
        by[key].sort();
    }
    return {ids: full.map(v => v.Id), by};
}

async function terminals_of(app, remote)
{
    if (remote_can(remote, 'term_list') === false) {
        throw new Error('its agent is from before kept terminals');
    }
    const answer = await remote_call(app, remote, 'term_list', {}, READ_TIMEOUT_MS);
    return Array.isArray(answer.items) ? answer.items.length : 0;
}

// The last stretch its agent counted as a reboot, as the Uptime tab shows it: the answer cuts
// each stretch at midnight, so one that crossed it is put together again
async function last_of(app, remote)
{
    if (remote_can(remote, 'uptime') === false) {
        throw new Error('its agent is from before uptime');
    }
    const answer = await remote_call(app, remote, 'uptime', {days: UPTIME_DAYS}, READ_TIMEOUT_MS);
    const days = Array.isArray(answer.days) ? answer.days : [];
    const reboots = days.flatMap(v => (Array.isArray(v.down) ? v.down : [])).filter(v => (v.why === 'reboot') && (typeof v.from === 'number') && (typeof v.to === 'number')).sort((a, b) => (a.from - b.from));
    if (reboots.length === 0) {
        return null;
    }
    const last = Object.assign({}, reboots[reboots.length - 1]);
    for (let i = reboots.length - 2; (i >= 0) && (reboots[i].to === last.from); i--) {
        last.from = reboots[i].from;
    }
    return {at: last.to, down_ms: last.to - last.from};
}

module.exports = machine_restart_facts;
