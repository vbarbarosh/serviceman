const docker_api = require('./docker_api');
const logline_follow = require('./logline_follow');
const timers = require('timers/promises');

// Every container a machine has, followed into the spool — the ones there when collection
// begins, stopped ones among them, and every one started after. Nothing a container wrote
// after the floor is left behind:
//
//   - a container started while the agent was down is in the list it reads first
//   - one that starts later is in docker's events; a list read again every few minutes, and
//     every time the events stream drops, catches whatever the events did not say
//   - one that stops is read to its end, and once more after that
//
// A container labelled logline=off is left alone; Logline's own containers are, so Logline
// does not log itself.
//
// ctx: {socket, spool, floor, host, say} -> {stop, containers}
const RELIST_MS = 5*60*1000;
const EVENTS_WAIT_MS = 1000;

function logline_collect(ctx)
{
    const run = Object.assign({}, ctx, {
        running: true,
        following: new Set(),
        skipped: new Set(),
        streams: new Set(),
        active: () => run.running,
    });
    containers_all(run);
    events_watch(run);
    const timer = setInterval(function () {
        containers_all(run);
    }, RELIST_MS);
    timer.unref();
    return {
        stop: function () {
            run.running = false;
            clearInterval(timer);
            for (const res of run.streams) {
                res.destroy();
            }
        },
        containers: () => run.following.size,
    };
}

async function containers_all(run)
{
    let list;
    try {
        list = await docker_api.json(run.socket, '/containers/json?all=1');
    }
    catch (error) {
        run.say('logline_docker_error', {reason: error.message, then: 'read again within five minutes'});
        return;
    }
    for (const item of list) {
        container_consider(run, item.Id);
    }
}

// docker's word as containers start, for as long as collection runs
async function events_watch(run)
{
    const filters = encodeURIComponent(JSON.stringify({type: ['container'], event: ['start']}));
    while (run.running) {
        try {
            const res = await docker_api(run.socket, `/events?filters=${filters}`);
            run.streams.add(res);
            let rest = '';
            for await (const chunk of res) {
                rest += chunk.toString('utf8');
                const lines = rest.split('\n');
                rest = lines.pop();
                for (const line of lines) {
                    const event = ((line.trim() === '') ? null : JSON.parse(line));
                    if ((event !== null) && (event.id !== undefined)) {
                        container_consider(run, event.id);
                    }
                }
            }
            run.streams.delete(res);
        }
        catch (error) {
            if (run.running) {
                run.say('logline_docker_error', {reason: error.message, then: 'listening again'});
            }
        }
        if (run.running === false) {
            return;
        }
        // Whatever started while nobody listened is in the list
        await timers.setTimeout(EVENTS_WAIT_MS);
        await containers_all(run);
    }
}

async function container_consider(run, id)
{
    if ((run.running === false) || run.following.has(id) || run.skipped.has(id)) {
        return;
    }
    run.following.add(id);
    try {
        for (;;) {
            let found;
            try {
                found = await docker_api.json(run.socket, `/containers/${encodeURIComponent(id)}/json`);
            }
            catch (error) {
                if (error.status === 404) {
                    // Gone before a line of it was read: what it wrote after the floor went with it
                    if (run.spool.cursor(id) === null) {
                        run.say('logline_lost', {container: id.slice(0, 12), reason: 'removed before it was read'});
                    }
                    return;
                }
                throw error;
            }
            const labels = (((found.Config === undefined) || (found.Config.Labels === null)) ? {} : found.Config.Labels);
            if (labels.logline === 'off') {
                run.skipped.add(id);
                return;
            }
            const container = {
                id: found.Id,
                name: String(found.Name || '').replace(/^\//, ''),
                image: ((found.Config === undefined) ? '' : found.Config.Image),
                tty: ((found.Config !== undefined) && (found.Config.Tty === true)),
                labels,
            };
            const ended = await logline_follow(run, container);
            if ((ended === 'gone') || (run.running === false)) {
                return;
            }
            // Started again while its last run was being read to the end: follow this run too
            const now = await docker_api.json(run.socket, `/containers/${encodeURIComponent(id)}/json`).catch(() => null);
            if ((now === null) || (now.State === undefined) || (now.State.Running !== true)) {
                return;
            }
        }
    }
    catch (error) {
        if (run.running) {
            run.say('logline_follow_error', {container: id.slice(0, 12), reason: error.message, then: 'read again within five minutes'});
        }
    }
    finally {
        run.following.delete(id);
    }
}

module.exports = logline_collect;
