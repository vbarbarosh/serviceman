const http = require('http');
const path = require('path');

const BODY_LIMIT_BYTES = 64*1024;

// How often a pull says how far it is, at most
const PROGRESS_EVERY_MS = 250;

const RE_CONTAINER_DO = /^\/containers\/([0-9a-f]{12,64})\/(start|stop|restart|remove)$/;
const RE_PROJECT_DO = /^\/projects\/([^/]+)\/(update|recreate)$/;
const RE_IMAGE_DO = /^\/images\/(sha256:[0-9a-f]{64}|[0-9a-f]{12,64})\/(remove|pull)$/;
const RE_VOLUME_DO = /^\/volumes\/([^/]+)\/remove$/;
const RE_VOLUME_HELPER = /^\/volumes\/([^/]+)\/(open|close)$/;

// A volume nothing mounts is opened through a container of this image that mounts it: small,
// with sh, find, stat and tar, pulled the first time it is wanted
const HELPER_IMAGE = 'docker.io/library/busybox:latest';
// Where the helper sees the volume, and how long it lives if nobody closes it
const HELPER_PATH = '/volume';
const HELPER_SECONDS = 3600;
// The labels a helper carries: it is left out of every list, and found again by its volume
const LABEL_HELPER = 'docker-module.helper';
const LABEL_HELPER_VOLUME = 'docker-module.volume';
const RE_NETWORK_DO = /^\/networks\/([0-9a-f]{12,64})\/remove$/;
const RE_PRUNE = /^\/(images|volumes|networks)\/prune$/;

// What a prune says when it finds nothing to take
const PRUNE_NOTHING = {
    images: 'nothing to remove: every image is in use, or kept read-only',
    volumes: 'nothing to remove: every volume is mounted by a container',
    networks: 'nothing to remove: every network has a container on it, or is built in',
};

// The networks every engine has from the start, which nothing removes
const NETWORKS_BUILTIN = ['bridge', 'host', 'none', 'podman'];

// What a compose project does for each action, after the project's own flags: update pulls the
// images and lets `up -d` make again only what changed; recreate takes every container down
// first, the way it is done by hand in a terminal
const PROJECT_STEPS = {
    update: [['pull'], ['up', '-d']],
    recreate: [['pull'], ['down'], ['up', '-d']],
};

// What a page calls each long action while it runs, and after a reload
const PROJECT_TITLES = {update: 'update', recreate: 'down and up'};
const PRUNE_TITLES = {
    'images': 'Removing dangling images',
    'images-all': 'Removing unused images',
    'volumes': 'Removing unused volumes',
    'networks': 'Removing unused networks',
};

// The labels compose puts on every container it makes
const LABEL_PROJECT = 'com.docker.compose.project';
const LABEL_SERVICE = 'com.docker.compose.service';
const LABEL_DIR = 'com.docker.compose.project.working_dir';
const LABEL_FILES = 'com.docker.compose.project.config_files';

// The Docker module's API, under whatever base the host mounts it at. The host gives two ways
// to reach a machine's docker: `connect()` opens a stream to its Engine API, and `run(argv)`
// runs its docker command — {ok, code, stdout, stderr} — for what only the command does, which
// is compose. Only the calls below go through; the engine itself is never handed out.
//
//     options = {connect, run, tail, log, own, stream}
//     own(name)       a container someone else runs, shown without actions
//     stream(title)   a stream the host keeps, {id, url, write(value), end(value)}: where a
//                     long action says what it does; without one it says it in its answer
async function docker_serve(req, res, options)
{
    const url = new URL(req.url, 'http://docker.invalid');
    const tail = options.tail;
    const ctx = {
        connect: options.connect,
        run: options.run,
        log: (options.log === undefined) ? function () {} : options.log,
        own: (options.own === undefined) ? own_none : options.own,
        stream: options.stream,
    };
    // GET <base>/containers
    if ((tail === '/containers') && (req.method === 'GET')) {
        await containers_serve(ctx, res);
        return;
    }
    // POST <base>/containers/<id>/start
    // POST <base>/containers/<id>/stop
    // POST <base>/containers/<id>/restart
    // POST <base>/containers/<id>/remove
    const container = RE_CONTAINER_DO.exec(tail);
    if ((container !== null) && (req.method === 'POST')) {
        await container_do(ctx, res, container[1], container[2]);
        return;
    }
    // POST <base>/projects/<name>/update
    // POST <base>/projects/<name>/recreate
    const project = RE_PROJECT_DO.exec(tail);
    if ((project !== null) && (req.method === 'POST')) {
        await body_read(req, BODY_LIMIT_BYTES).catch(function () {});
        await project_do(ctx, res, decodeURIComponent(project[1]), project[2]);
        return;
    }
    // GET <base>/images
    // GET <base>/volumes
    // GET <base>/networks
    if (((tail === '/images') || (tail === '/volumes') || (tail === '/networks')) && (req.method === 'GET')) {
        await store_serve(ctx, res, tail.slice(1));
        return;
    }
    // POST <base>/images/<id>/remove
    // POST <base>/images/<id>/pull
    const image = RE_IMAGE_DO.exec(tail);
    if ((image !== null) && (req.method === 'POST')) {
        if (image[2] === 'pull') {
            await image_pull(ctx, res, image[1]);
            return;
        }
        await store_remove(ctx, res, 'image', `/images/${image[1]}`, image[1]);
        return;
    }
    // POST <base>/volumes/<name>/remove
    const volume = RE_VOLUME_DO.exec(tail);
    if ((volume !== null) && (req.method === 'POST')) {
        await store_remove(ctx, res, 'volume', `/volumes/${encodeURIComponent(decodeURIComponent(volume[1]))}`, decodeURIComponent(volume[1]));
        return;
    }
    // POST <base>/volumes/<name>/open
    // POST <base>/volumes/<name>/close
    const helper = RE_VOLUME_HELPER.exec(tail);
    if ((helper !== null) && (req.method === 'POST')) {
        await volume_helper(ctx, res, decodeURIComponent(helper[1]), helper[2]);
        return;
    }
    // POST <base>/networks/<id>/remove
    const network = RE_NETWORK_DO.exec(tail);
    if ((network !== null) && (req.method === 'POST')) {
        await store_remove(ctx, res, 'network', `/networks/${network[1]}`, network[1]);
        return;
    }
    // POST <base>/images/prune (query: all)
    // POST <base>/volumes/prune
    // POST <base>/networks/prune
    const prune = RE_PRUNE.exec(tail);
    if ((prune !== null) && (req.method === 'POST')) {
        await store_prune(ctx, res, prune[1], url.searchParams.get('all') === '1');
        return;
    }
    send_json(res, 404, {error: `no such door: ${url.pathname}`});
}

function own_none()
{
    return false;
}

// GET <base>/containers
// Every container of the machine, running or not, as the page shows it
async function containers_serve(ctx, res)
{
    let answer;
    try {
        answer = await engine_call(ctx.connect, 'GET', '/containers/json?all=1');
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
        return;
    }
    if (answer.status !== 200) {
        send_json(res, 502, {error: engine_said(answer)});
        return;
    }
    send_json(res, 200, {containers: JSON.parse(answer.body).filter(v => is_helper(v) === false).map(v => container_view(ctx, v))});
}

function container_view(ctx, item)
{
    const labels = ((item.Labels === null) || (item.Labels === undefined)) ? {} : item.Labels;
    const name = (Array.isArray(item.Names) && (item.Names.length > 0)) ? item.Names[0].replace(/^\//, '') : item.Id.slice(0, 12);
    return {
        id: item.Id,
        name,
        image: item.Image,
        state: item.State,
        status: item.Status,
        created_ms: item.Created*1000,
        ports: ports_text(item.Ports),
        project: (labels[LABEL_PROJECT] === undefined) ? null : labels[LABEL_PROJECT],
        service: (labels[LABEL_SERVICE] === undefined) ? null : labels[LABEL_SERVICE],
        dir: (labels[LABEL_DIR] === undefined) ? null : labels[LABEL_DIR],
        own: ctx.own(name),
    };
}

// GET <base>/images
// GET <base>/volumes
// GET <base>/networks
// The images, volumes or networks of the machine, each with the containers that use it — the
// engine's own lists say it of none of them, or say -1
async function store_serve(ctx, res, kind)
{
    try {
        const listed = await engine_call(ctx.connect, 'GET', (kind === 'images') ? '/images/json' : `/${kind}`);
        const containers = await engine_call(ctx.connect, 'GET', '/containers/json?all=1');
        if ((listed.status !== 200) || (containers.status !== 200)) {
            send_json(res, 502, {error: engine_said((listed.status !== 200) ? listed : containers)});
            return;
        }
        const body = JSON.parse(listed.body);
        const users = JSON.parse(containers.body).filter(v => is_helper(v) === false).map(v => ({id: v.Id, name: name_of(v), state: v.State, image: v.ImageID, mounts: Array.isArray(v.Mounts) ? v.Mounts : [], networks: Object.keys((v.NetworkSettings && v.NetworkSettings.Networks) || {})}));
        if (kind === 'images') {
            send_json(res, 200, {images: body.map(v => image_view(v, users))});
            return;
        }
        if (kind === 'volumes') {
            send_json(res, 200, {volumes: (Array.isArray(body.Volumes) ? body.Volumes : []).map(v => volume_view(v, users))});
            return;
        }
        send_json(res, 200, {networks: body.map(v => network_view(v, users))});
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

function image_view(item, users)
{
    const tags = (Array.isArray(item.RepoTags) ? item.RepoTags : []).filter(v => v !== '<none>:<none>');
    return {
        id: item.Id,
        tags,
        size: item.Size,
        created_ms: item.Created*1000,
        used_by: users.filter(v => v.image === item.Id).map(v => v.name),
        dangling: (tags.length === 0),
        // podman keeps images in stores it may only read; those stay whatever is asked
        read_only: (item.ReadOnly === true),
    };
}

function volume_view(item, users)
{
    const labels = ((item.Labels === null) || (item.Labels === undefined)) ? {} : item.Labels;
    return {
        name: item.Name,
        driver: item.Driver,
        created_ms: item.CreatedAt ? Date.parse(item.CreatedAt) : null,
        project: (labels[LABEL_PROJECT] === undefined) ? null : labels[LABEL_PROJECT],
        used_by: users.filter(v => v.mounts.some(vv => (vv.Type === 'volume') && (vv.Name === item.Name))).map(v => v.name),
        // Where its files lie on the machine, and where each container sees them
        mountpoint: item.Mountpoint ? item.Mountpoint : null,
        mounts: users.flatMap(v => v.mounts.filter(vv => (vv.Type === 'volume') && (vv.Name === item.Name)).map(vv => ({id: v.id, name: v.name, running: (v.state === 'running'), destination: vv.Destination}))),
    };
}

function network_view(item, users)
{
    const labels = ((item.Labels === null) || (item.Labels === undefined)) ? {} : item.Labels;
    const config = (item.IPAM && Array.isArray(item.IPAM.Config)) ? item.IPAM.Config : [];
    return {
        id: item.Id,
        name: item.Name,
        driver: item.Driver,
        subnet: config.map(v => v.Subnet).filter(v => v).join(', '),
        project: (labels[LABEL_PROJECT] === undefined) ? null : labels[LABEL_PROJECT],
        used_by: users.filter(v => v.networks.includes(item.Name)).map(v => v.name),
        builtin: NETWORKS_BUILTIN.includes(item.Name),
    };
}

// A container this module started to open a volume, which no list shows
function is_helper(item)
{
    return Boolean(item.Labels && (item.Labels[LABEL_HELPER] === 'volume'));
}

// POST <base>/volumes/<name>/open
// POST <base>/volumes/<name>/close
// A volume nothing mounts, opened: a small container that mounts it and sleeps, through which
// the File Manager and the Terminal reach it as they reach any container. It is made the first
// time, found again after, removed on close — and by docker itself within the hour, if the page
// that opened it never comes back.
async function volume_helper(ctx, res, name, action)
{
    try {
        const listed = await engine_call(ctx.connect, 'GET', `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({label: [`${LABEL_HELPER_VOLUME}=${name}`]}))}`);
        const found = (listed.status === 200) ? JSON.parse(listed.body).filter(v => is_helper(v) && (v.Labels[LABEL_HELPER_VOLUME] === name)) : [];
        if (action === 'close') {
            // Killed first: sleep, the helper's first process, would sit through a stop's SIGTERM
            // and keep a remove waiting for the whole stop timeout
            for (const item of found) {
                await engine_call(ctx.connect, 'POST', `/containers/${item.Id}/kill`);
                await engine_call(ctx.connect, 'DELETE', `/containers/${item.Id}?force=1`);
                ctx.log('docker_volume_closed', {volume: name, helper: item.Id.slice(0, 12)});
            }
            send_json(res, 200, {});
            return;
        }
        const running = found.find(v => v.State === 'running');
        if (running !== undefined) {
            send_json(res, 200, {id: running.Id, path: HELPER_PATH});
            return;
        }
        await image_ensure(ctx, HELPER_IMAGE);
        const created = await engine_call(ctx.connect, 'POST', '/containers/create', {
            Image: HELPER_IMAGE,
            Cmd: ['sleep', String(HELPER_SECONDS)],
            Labels: {[LABEL_HELPER]: 'volume', [LABEL_HELPER_VOLUME]: name},
            HostConfig: {Binds: [`${name}:${HELPER_PATH}`], AutoRemove: true},
        });
        if (created.status !== 201) {
            send_json(res, 502, {error: engine_said(created)});
            return;
        }
        const id = JSON.parse(created.body).Id;
        const started = await engine_call(ctx.connect, 'POST', `/containers/${id}/start`);
        if ((started.status !== 204) && (started.status !== 304)) {
            send_json(res, 502, {error: engine_said(started)});
            return;
        }
        ctx.log('docker_volume_opened', {volume: name, helper: id.slice(0, 12)});
        send_json(res, 200, {id, path: HELPER_PATH});
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

// An image there to make a container from, pulled when it is not
async function image_ensure(ctx, image)
{
    const there = await engine_call(ctx.connect, 'GET', `/images/${encodeURIComponent(image)}/json`);
    if (there.status === 200) {
        return;
    }
    const at = image.lastIndexOf(':');
    const pulled = await engine_stream(ctx.connect, 'POST', `/images/create?fromImage=${encodeURIComponent(image.slice(0, at))}&tag=${encodeURIComponent(image.slice(at + 1))}`);
    let text = '';
    for await (const chunk of pulled) {
        text += chunk.toString('utf8');
    }
    const failed = text.split('\n').map(v => v.trim().startsWith('{') ? JSON.parse(v) : {}).find(v => v.error);
    if ((pulled.statusCode !== 200) || (failed !== undefined)) {
        throw new Error(`${image} could not be pulled: ${(failed === undefined) ? `docker answered ${pulled.statusCode}` : failed.error}`);
    }
}

function name_of(item)
{
    return (Array.isArray(item.Names) && (item.Names.length > 0)) ? item.Names[0].replace(/^\//, '') : item.Id.slice(0, 12);
}

// POST <base>/images/<id>/remove
// POST <base>/volumes/<name>/remove
// POST <base>/networks/<id>/remove
// One image, volume or network taken away. One still in use is refused by the engine, and its
// word is the answer; nothing here forces it.
async function store_remove(ctx, res, kind, pathname, name)
{
    try {
        const answer = await engine_call(ctx.connect, 'DELETE', pathname);
        if ((answer.status !== 200) && (answer.status !== 204)) {
            send_json(res, (answer.status === 409) ? 409 : 502, {error: engine_said(answer)});
            return;
        }
        ctx.log(`docker_${kind}_removed`, {name: (kind === 'volume') ? name : name.replace(/^sha256:/, '').slice(0, 12)});
        send_json(res, 200, {});
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

// POST <base>/images/prune (query: all)
// POST <base>/volumes/prune
// POST <base>/networks/prune
// What no container uses, taken away one at a time, so the page can say how far it is: dangling
// images only, or with `all` every image no container was made from (one podman may only read
// stays); volumes no container mounts; networks no container is on, the built-in ones aside.
// One the engine refuses on the way is said and left; the rest go on.
async function store_prune(ctx, res, kind, all)
{
    let found;
    try {
        found = await prune_found(ctx, kind, all);
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
        return;
    }
    const progress = progress_begin(ctx, res, PRUNE_TITLES[all ? `${kind}-all` : kind]);
    // Nothing to take is said as that, with no bar to stand at nought
    if (found.length === 0) {
        progress_end(progress, 'done', PRUNE_NOTHING[kind]);
        return;
    }
    const total_bytes = found.reduce((sum, v) => sum + v.size, 0);
    let removed = 0;
    let freed = 0;
    progress_say(progress, {progress: {done: 0, total: found.length, bytes: 0, total_bytes, unit: 'items'}});
    for (let i = 0; i < found.length; i++) {
        const item = found[i];
        let answer;
        try {
            answer = await engine_call(ctx.connect, 'DELETE', item.path);
        }
        catch (error) {
            answer = {status: 0, body: JSON.stringify({message: error.message})};
        }
        if ((answer.status === 200) || (answer.status === 204)) {
            removed++;
            freed += item.size;
            progress_say(progress, {text: `removed ${item.label}${(item.size > 0) ? ` (${bytes_text(item.size)})` : ''}`});
        }
        else {
            progress_say(progress, {text: `kept ${item.label}: ${engine_said(answer)}`});
        }
        progress_say(progress, {progress: {done: i + 1, total: found.length, bytes: freed, total_bytes, unit: 'items'}});
    }
    ctx.log(`docker_${kind}_pruned`, {removed, reclaimed: freed});
    // Images share layers, so their sizes added up say the most that was freed, not exactly that
    progress_end(progress, 'done', `removed ${removed} of ${found.length}${(freed > 0) ? `, up to ${bytes_text(freed)} freed` : ''}`);
}

// What a prune would take: each with its address for the engine, a name to say, its size
async function prune_found(ctx, kind, all)
{
    const listed = await engine_call(ctx.connect, 'GET', (kind === 'images') ? '/images/json' : `/${kind}`);
    const containers = await engine_call(ctx.connect, 'GET', '/containers/json?all=1');
    if ((listed.status !== 200) || (containers.status !== 200)) {
        throw new Error(engine_said((listed.status !== 200) ? listed : containers));
    }
    const body = JSON.parse(listed.body);
    const users = JSON.parse(containers.body).filter(v => is_helper(v) === false).map(v => ({name: name_of(v), state: v.State, image: v.ImageID, mounts: Array.isArray(v.Mounts) ? v.Mounts : [], networks: Object.keys((v.NetworkSettings && v.NetworkSettings.Networks) || {})}));
    if (kind === 'images') {
        return body.map(v => image_view(v, users)).filter(v => (v.used_by.length === 0) && (v.read_only === false) && (all || v.dangling)).map(v => ({path: `/images/${v.id.replace(/^sha256:/, '')}`, label: (v.tags.length === 0) ? v.id.replace(/^sha256:/, '').slice(0, 12) : v.tags[0], size: v.size}));
    }
    if (kind === 'volumes') {
        return (Array.isArray(body.Volumes) ? body.Volumes : []).map(v => volume_view(v, users)).filter(v => v.used_by.length === 0).map(v => ({path: `/volumes/${encodeURIComponent(v.name)}`, label: v.name, size: 0}));
    }
    return body.map(v => network_view(v, users)).filter(v => (v.used_by.length === 0) && (v.builtin === false)).map(v => ({path: `/networks/${v.id}`, label: v.name, size: 0}));
}

// POST <base>/images/<id>/pull
// An image pulled again under its first tag: the engine's progress, a line each time a layer
// says something new, then the word that ends it
async function image_pull(ctx, res, id)
{
    let tag;
    try {
        const listed = await engine_call(ctx.connect, 'GET', '/images/json');
        const found = JSON.parse(listed.body).find(v => (v.Id === id) || (v.Id === `sha256:${id}`));
        tag = (found === undefined) ? undefined : (Array.isArray(found.RepoTags) ? found.RepoTags : []).find(v => v !== '<none>:<none>');
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
        return;
    }
    if (tag === undefined) {
        send_json(res, 404, {error: 'an image is pulled again under its name, and this one has none'});
        return;
    }
    const at = tag.lastIndexOf(':');
    const repo = (at > tag.lastIndexOf('/')) ? tag.slice(0, at) : tag;
    const version = (at > tag.lastIndexOf('/')) ? tag.slice(at + 1) : 'latest';
    const progress = progress_begin(ctx, res, `pull ${tag}`);
    progress_say(progress, {text: `$ docker pull ${tag}`});
    ctx.log('docker_image_pull_begin', {image: tag});
    let failed = null;
    // Each layer's bytes, done of total, added up into one number for the whole image
    const layers = {};
    let said_at = 0;
    try {
        const pulled = await engine_stream(ctx.connect, 'POST', `/images/create?fromImage=${encodeURIComponent(repo)}&tag=${encodeURIComponent(version)}`);
        const said = {};
        let held = '';
        for await (const chunk of pulled) {
            held += chunk.toString('utf8');
            const lines = held.split('\n');
            held = lines.pop();
            for (const line of lines) {
                failed = (failed === null) ? pull_line(progress, said, layers, line) : failed;
            }
            if (Date.now() - said_at > PROGRESS_EVERY_MS) {
                said_at = Date.now();
                pull_progress(progress, layers);
            }
        }
        failed = (failed === null) ? pull_line(progress, said, layers, held) : failed;
        if ((pulled.statusCode !== 200) && (failed === null)) {
            failed = `docker answered ${pulled.statusCode}`;
        }
    }
    catch (error) {
        failed = error.message;
    }
    if (failed !== null) {
        progress_end(progress, 'failed', failed);
        ctx.log('docker_image_pull_end_error', {image: tag, reason: failed});
        return;
    }
    pull_progress(progress, layers);
    progress_end(progress, 'done', `${tag} is the newest there is`);
    ctx.log('docker_image_pull_end_ok', {image: tag});
}

// The whole image's bytes so far, from what every layer said last
function pull_progress(progress, layers)
{
    const all = Object.values(layers).filter(v => v.total > 0);
    if (all.length > 0) {
        progress_say(progress, {progress: {done: all.reduce((sum, v) => sum + Math.min(v.current, v.total), 0), total: all.reduce((sum, v) => sum + v.total, 0), unit: 'bytes'}});
    }
}

// One line of the engine's pull progress: a layer's bytes kept for the sum, a line said when the
// layer says something new; an error is returned to end the pull with
function pull_line(progress, said, layers, line)
{
    if (line.trim() === '') {
        return null;
    }
    let item;
    try {
        item = JSON.parse(line);
    }
    catch {
        // Podman writes some of its progress as plain text
        progress_say(progress, {text: line});
        return null;
    }
    if (item.error) {
        return String(item.error);
    }
    const key = (item.id === undefined) ? '' : item.id;
    if ((key !== '') && item.progressDetail && (item.progressDetail.total > 0) && (item.status === 'Downloading')) {
        layers[key] = {current: item.progressDetail.current, total: item.progressDetail.total};
    }
    if ((key !== '') && (layers[key] !== undefined) && /complete|Already exists/i.test(String(item.status))) {
        layers[key].current = layers[key].total;
    }
    const text = (item.status === undefined) ? ((item.stream === undefined) ? '' : String(item.stream).trim()) : String(item.status);
    if ((text === '') || (said[key] === text)) {
        return null;
    }
    said[key] = text;
    progress_say(progress, {text: `${(key === '') ? '' : `${key}: `}${text}`});
    return null;
}

// "0.0.0.0:8080→80/tcp" for each published port, once however many addresses it is on
function ports_text(ports)
{
    const out = [];
    for (const item of (Array.isArray(ports) ? ports : [])) {
        const text = (item.PublicPort === undefined) ? `${item.PrivatePort}/${item.Type}` : `${item.PublicPort}→${item.PrivatePort}/${item.Type}`;
        if (out.includes(text) === false) {
            out.push(text);
        }
    }
    return out;
}

// POST <base>/containers/<id>/start
// POST <base>/containers/<id>/stop
// POST <base>/containers/<id>/restart
// POST <base>/containers/<id>/remove
async function container_do(ctx, res, id, action)
{
    try {
        // A running container is not removed: the engine refuses, and its word is the answer
        const answer = (action === 'remove') ? await engine_call(ctx.connect, 'DELETE', `/containers/${id}`) : await engine_call(ctx.connect, 'POST', `/containers/${id}/${action}`);
        // 304 is a container already started, or already stopped: what was asked is so
        if ((answer.status !== 204) && (answer.status !== 304)) {
            send_json(res, 502, {error: engine_said(answer)});
            return;
        }
        ctx.log(`docker_container_${action}`, {id: id.slice(0, 12)});
        send_json(res, 200, {});
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
    }
}

// POST <base>/projects/<name>/update
// POST <base>/projects/<name>/recreate
// One compose project, step after step, its folder and files taken from its containers' labels
// — never from the page. The answer is text, written as the steps go: each step's command,
// then what it printed, then the word that ends it.
async function project_do(ctx, res, project, action)
{
    let found;
    try {
        found = await project_find(ctx, project);
    }
    catch (error) {
        send_json(res, 502, {error: error.message});
        return;
    }
    if (found === null) {
        send_json(res, 404, {error: `no container says it is of compose project ${project}, with the folder it came from`});
        return;
    }
    const progress = progress_begin(ctx, res, `${project} · ${PROJECT_TITLES[action]}`);
    ctx.log('docker_project_begin', {project, action});
    const steps = PROJECT_STEPS[action];
    for (let i = 0; i < steps.length; i++) {
        const argv = ['compose', '-p', project].concat(found.files.flatMap(v => ['-f', v]), steps[i]);
        progress_say(progress, {step: i + 1, steps: steps.length, name: steps[i].join(' '), text: `$ docker ${argv.join(' ')}`});
        let answer;
        try {
            answer = await ctx.run(argv);
        }
        catch (error) {
            answer = {ok: false, code: null, stdout: '', stderr: error.message};
        }
        const printed = `${answer.stdout}${answer.stderr}`.replace(/\n$/, '');
        if (printed !== '') {
            progress_say(progress, {text: printed});
        }
        if (answer.ok === false) {
            progress_end(progress, 'failed', `${steps[i].join(' ')} failed${((answer.code === null) || (answer.code === undefined)) ? '' : ` with code ${answer.code}`}`);
            ctx.log('docker_project_end_error', {project, action, step: steps[i].join(' ')});
            return;
        }
    }
    progress_end(progress, 'done', `${project}: ${steps.map(v => v.join(' ')).join(', then ')}`);
    ctx.log('docker_project_end_ok', {project, action});
}

// The folder and compose files of a project, as its containers' labels say. Each file is named
// in full: compose takes the project's folder from the first one, which is how both docker
// compose and podman-compose find it — podman-compose has no --project-directory, and writes
// the files relative to the folder.
async function project_find(ctx, project)
{
    const answer = await engine_call(ctx.connect, 'GET', '/containers/json?all=1');
    if (answer.status !== 200) {
        throw new Error(engine_said(answer));
    }
    for (const item of JSON.parse(answer.body)) {
        const labels = ((item.Labels === null) || (item.Labels === undefined)) ? {} : item.Labels;
        if ((labels[LABEL_PROJECT] === project) && (labels[LABEL_DIR] !== undefined)) {
            const files = (labels[LABEL_FILES] === undefined) ? [] : labels[LABEL_FILES].split(',').filter(v => v !== '');
            return {dir: labels[LABEL_DIR], files: files.map(v => path.resolve(labels[LABEL_DIR], v))};
        }
    }
    return null;
}

// A long action answers as it goes, one JSON object a line: {text} for what it printed,
// {progress: {done, total, unit}} for how far it is, {step, steps, name} for which step it is
// on, and last {end: done | failed, said}. A host that keeps streams gets them in one, and the
// answer is its id at once, {stream, url}: the action goes on when the page that asked goes
// away, and the page reads it there again. Without, the lines are the answer itself.
function progress_begin(ctx, res, title)
{
    if (ctx.stream === undefined) {
        res.writeHead(200, {'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
        return {
            write: v => res.write(`${JSON.stringify(v)}\n`),
            end: v => res.end(`${JSON.stringify(v)}\n`),
        };
    }
    const stream = ctx.stream(title);
    send_json(res, 202, {stream: stream.id, url: stream.url});
    return stream;
}

function progress_say(progress, value)
{
    progress.write(value);
}

function progress_end(progress, outcome, said)
{
    progress.end({end: outcome, said});
}

function bytes_text(bytes)
{
    const names = ['B', 'KB', 'MB', 'GB', 'TB'];
    const step = Math.min(names.length - 1, Math.max(0, Math.floor(Math.log(Math.max(1, bytes))/Math.log(1024))));
    const value = bytes/Math.pow(1024, step);
    return `${value.toFixed(((step === 0) || (value >= 100)) ? 0 : 1)}${names[step]}`;
}

// One request to the Engine API, its answer as it streams
function engine_stream(connect, method, pathname)
{
    return new Promise(function (resolve, reject) {
        const request = http.request({createConnection: connect, method, path: pathname, headers: {host: 'docker'}}, resolve);
        request.on('error', reject);
        request.end();
    });
}

// One request to the Engine API, over whatever stream `connect` opens; a value goes as JSON
function engine_call(connect, method, path, value)
{
    return new Promise(function (resolve, reject) {
        const body = (value === undefined) ? null : JSON.stringify(value);
        const headers = (body === null) ? {host: 'docker'} : {'host': 'docker', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body)};
        const request = http.request({createConnection: connect, method, path, headers}, function (answer) {
            const chunks = [];
            answer.on('data', v => chunks.push(v));
            answer.on('end', () => resolve({status: answer.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
            answer.on('error', reject);
        });
        request.on('error', reject);
        request.end((body === null) ? undefined : body);
    });
}

function engine_said(answer)
{
    try {
        return `docker answered ${answer.status}: ${JSON.parse(answer.body).message}`;
    }
    catch {
        return `docker answered ${answer.status}`;
    }
}

// A small request body; a body above the limit is refused, not buffered
function body_read(req, limit_bytes)
{
    return new Promise(function (resolve, reject) {
        const chunks = [];
        let size = 0;
        req.on('data', function (chunk) {
            size += chunk.length;
            if (size > limit_bytes) {
                reject(new Error(`the body is above ${limit_bytes} bytes`));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', function () {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        req.on('error', reject);
    });
}

function send_json(res, status, value)
{
    const text = JSON.stringify(value, null, 4);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-store',
    });
    res.end(text);
}

module.exports = docker_serve;
