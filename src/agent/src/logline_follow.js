const docker_api = require('./docker_api');
const docker_log_reader = require('./docker_log_reader');
const logline_line_cut = require('./logline_line_cut');
const logline_time_strip = require('./logline_time_strip');

// One container's output into the spool, from where its reading stood, until the container
// stops — and once more after that, for anything that came in while the stream was closing.
//
// Where it stood is the spool's own word: the latest stamp it holds for this container, and how
// many of its lines share that stamp. Docker is asked for everything since that stamp, the
// stamp itself included, and the lines already held are skipped by count. Before the floor
// nothing is read: the floor is when collection was switched on.
//
// ctx: {socket, spool, floor, host, active}. Answers 'gone' when docker no longer knows it.
async function logline_follow(ctx, container)
{
    for (const follow of [true, false]) {
        const read = await logs_read(ctx, container, follow);
        if ((read === 'gone') || (ctx.active() === false)) {
            return read;
        }
    }
    return 'ended';
}

async function logs_read(ctx, container, follow)
{
    const kept = ctx.spool.cursor(container.id);
    const from = ((kept === null) || (kept.at < ctx.floor)) ? {at: ctx.floor, n: 0} : kept;
    const query = `follow=${follow ? 1 : 0}&stdout=1&stderr=1&timestamps=1&since=${unix_of(from.at)}`;
    const res = await docker_api(ctx.socket, `/containers/${encodeURIComponent(container.id)}/logs?${query}`);
    if (res.statusCode === 404) {
        res.resume();
        return 'gone';
    }
    if (res.statusCode !== 200) {
        const chunks = [];
        for await (const chunk of res) {
            chunks.push(chunk);
        }
        throw new Error(`docker ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').trim()}`);
    }
    ctx.streams.add(res);
    try {
        const reader = docker_log_reader(container.tty);
        const state = {skip: from.n, from: from.at, last_at: from.at};
        for await (const chunk of res) {
            for (const item of reader.push(chunk)) {
                // At its cap the spool takes nothing more: the stream is not read, docker
                // holds the lines, and reading goes on where it stopped once there is room
                if (ctx.spool.full()) {
                    await ctx.spool.room();
                }
                if (ctx.active() === false) {
                    return 'stopped';
                }
                line_keep(ctx, container, state, item);
            }
        }
        for (const item of reader.end()) {
            line_keep(ctx, container, state, item);
        }
    }
    finally {
        ctx.streams.delete(res);
    }
    return 'read';
}

function line_keep(ctx, container, state, item)
{
    const at = (item.at === null) ? state.last_at : item.at;
    // Already held: before the stamp it resumes from, or one of the lines at that stamp
    if (at < state.from) {
        return;
    }
    if ((at === state.from) && (state.skip > 0)) {
        state.skip -= 1;
        return;
    }
    state.last_at = at;
    const stripped = logline_time_strip(item.text.trimEnd());
    ctx.spool.append({
        src: container.id,
        at,
        time: (stripped.time === null) ? at : stripped.time,
        labels: labels_of(ctx, container, item.stream),
        line: logline_line_cut(stripped.line),
    });
}

// What the line is about, from what docker knows of the container: compose's own labels where
// compose made it
function labels_of(ctx, container, stream)
{
    const labels = container.labels || {};
    // A container serviceman made says which of its services it is: the name the control page
    // shows, not serviceman-<name>, so a link from that page finds its lines
    const out = {host: ctx.host, service: labels['serviceman.service'] || labels['com.docker.compose.service'] || container.name};
    if (labels['com.docker.compose.project'] !== undefined) {
        out.project = labels['com.docker.compose.project'];
    }
    out.container = container.name;
    out.container_id = container.id.slice(0, 12);
    out.image = container.image;
    out.stream = stream;
    return out;
}

// "2026-09-25T18:17:09.979123456Z" -> "1790360229.979123456", which is how the engine takes
// a moment to the nanosecond
function unix_of(at)
{
    return `${Math.floor(Date.parse(`${at.slice(0, 19)}Z`)/1000)}.${at.slice(20, 29)}`;
}

module.exports = logline_follow;
