const path = require('path');

// The labels compose puts on every container and volume it makes
const LABEL_PROJECT = 'com.docker.compose.project';
const LABEL_DIR = 'com.docker.compose.project.working_dir';

// What a machine's docker holds on its disk, added up for each compose project: docker's own
// count (its /system/df) of each image, of what each container wrote over its image (the
// container's own overlay layer) and of each volume; and what docker does not count, each
// container's folder under docker's root (its log, its settings) and each project's own
// folder (its compose file, the folders it binds), as the host counted them.
//
// A project's image is every image its containers were made from, each counted once in it,
// whole: the layers it shares with other images too, as `docker images` says its size. An
// image or a volume two projects use is counted in both, and said to be shared; the machine's
// totals count each once.
//
//     df          the Engine API's /system/df
//     containers  its /containers/json?all=1: the compose labels, and the mounts podman's df
//                 leaves out
//     logs        {sizes: Map of container id to bytes} or {error}
//     folders     Map of a project's folder to {size, unread} or {error}
//     ->          {projects: [{project, dir, total, parts: {image, written, volumes, logs,
//                 folder}, unread, images: [{id, name, size, shared}], volumes: [{name, size,
//                 shared}]}], containers: {<id>: {written, log}}, volumes: {<name>: size},
//                 totals: {images, images_unused, written, volumes, logs, folders,
//                 build_cache}, missing: {logs, folders}}
//
// A size docker did not count (a volume of another driver, -1) is null, and so is a part not
// counted (missing says why); a project's total adds the parts that were.
function docker_disk(df, containers, logs, folders)
{
    const images = new Map((Array.isArray(df.Images) ? df.Images : []).map(v => [bare_id(v.Id), v]));
    const written = new Map((Array.isArray(df.Containers) ? df.Containers : []).map(v => [v.Id, (typeof v.SizeRw === 'number') ? v.SizeRw : 0]));
    const volume_sizes = new Map((Array.isArray(df.Volumes) ? df.Volumes : []).map(v => [v.Name, volume_size(v)]));
    const log_sizes = (logs.sizes === undefined) ? null : logs.sizes;

    // Each container in its project, '' for the ones in none
    const groups = new Map();
    for (const item of containers) {
        const labels = labels_of(item);
        const key = (labels[LABEL_PROJECT] === undefined) ? '' : labels[LABEL_PROJECT];
        if (groups.has(key) === false) {
            groups.set(key, {project: (key === '') ? null : key, dir: (labels[LABEL_DIR] === undefined) ? null : labels[LABEL_DIR], containers: []});
        }
        groups.get(key).containers.push(item);
    }
    // A volume compose made for a project belongs to it, mounted or not
    for (const item of (Array.isArray(df.Volumes) ? df.Volumes : [])) {
        const project = labels_of(item)[LABEL_PROJECT];
        if ((project !== undefined) && (groups.has(project) === false)) {
            groups.set(project, {project, dir: null, containers: []});
        }
    }

    // Which projects use each image and each volume, to say which are shared
    const image_users = new Map();
    const volume_users = new Map();
    for (const [key, group] of groups) {
        for (const item of group.containers) {
            users_add(image_users, bare_id(item.ImageID || ''), key);
            for (const mount of (Array.isArray(item.Mounts) ? item.Mounts : [])) {
                if (mount.Type === 'volume') {
                    users_add(volume_users, mount.Name, key);
                }
            }
        }
    }
    for (const item of (Array.isArray(df.Volumes) ? df.Volumes : [])) {
        const project = labels_of(item)[LABEL_PROJECT];
        if (project !== undefined) {
            users_add(volume_users, item.Name, project);
        }
    }

    const projects = [];
    for (const [key, group] of groups) {
        const image_list = [];
        for (const item of group.containers) {
            const id = bare_id(item.ImageID || '');
            if ((id !== '') && (image_list.some(v => v.id === id) === false)) {
                const image = images.get(id);
                image_list.push({id, name: image_name(item, image, id), size: (image === undefined) ? null : image.Size, shared: users_other(image_users, id, key)});
            }
        }
        const volume_names = Array.from(volume_users).filter(v => v[1].has(key)).map(v => v[0]).sort();
        const volume_list = volume_names.map(v => ({name: v, size: volume_sizes.has(v) ? volume_sizes.get(v) : null, shared: users_other(volume_users, v, key)}));
        const counted = ((group.dir === null) || (folders.has(group.dir) === false)) ? {} : folders.get(group.dir);
        const parts = {
            image: sum(image_list.map(v => v.size)),
            written: sum(group.containers.map(v => written.has(v.Id) ? written.get(v.Id) : null)),
            volumes: sum(volume_list.map(v => v.size)),
            logs: (log_sizes === null) ? null : sum(group.containers.map(v => log_sizes.has(v.Id) ? log_sizes.get(v.Id) : 0)),
            folder: (counted.size === undefined) ? null : counted.size,
        };
        // unread: the folders in its folder du could not read, whose size is in no part
        projects.push({project: group.project, dir: group.dir, total: sum(Object.values(parts)) || 0, parts, unread: counted.unread || 0, images: image_list, volumes: volume_list});
    }
    projects.sort((a, b) => ((a.project === null) - (b.project === null)) || String(a.project).localeCompare(String(b.project)));

    const per_container = {};
    for (const item of containers) {
        per_container[item.Id] = {written: written.has(item.Id) ? written.get(item.Id) : null, log: ((log_sizes === null) || (log_sizes.has(item.Id) === false)) ? null : log_sizes.get(item.Id)};
    }
    const folder_sizes = Array.from(folders.values()).map(v => ((v.size === undefined) ? null : v.size));
    return {
        projects,
        containers: per_container,
        volumes: Object.fromEntries(volume_sizes),
        totals: {
            images: images_total(df, images),
            images_unused: images_unused(df, images, image_users),
            written: sum(Array.from(written.values())) || 0,
            volumes: sum(Array.from(volume_sizes.values())) || 0,
            logs: (log_sizes === null) ? null : sum(Array.from(log_sizes.values())) || 0,
            folders: sum(folder_sizes),
            build_cache: build_cache(df),
        },
        missing: {
            logs: (log_sizes === null) ? logs.error : null,
            folders: folders_missing(folders),
        },
    };
}

// The container folders one count of docker's root found, by id: docker keeps one a container
// in `containers/`, podman in `overlay-containers/`, each named by the container's whole id
docker_disk.log_sizes = function (counted) {
    const out = new Map();
    for (const item of counted.folders) {
        const name = path.posix.basename(item.path);
        if (/^[0-9a-f]{64}$/.test(name)) {
            out.set(name, item.size);
        }
    }
    return out;
};

// Where an engine keeps its containers' folders, under its root; null where it does not say
docker_disk.logs_folder = function (info, version) {
    if ((typeof info.DockerRootDir !== 'string') || (path.posix.isAbsolute(info.DockerRootDir) === false)) {
        return null;
    }
    const podman = Array.isArray(version.Components) && version.Components.some(v => /podman/i.test(String(v.Name)));
    return path.posix.join(info.DockerRootDir, podman ? 'overlay-containers' : 'containers');
};

function labels_of(item)
{
    return ((item.Labels === null) || (item.Labels === undefined)) ? {} : item.Labels;
}

// docker names an image sha256:<hex>, podman by the hex alone
function bare_id(id)
{
    return String(id).replace(/^sha256:/, '');
}

function volume_size(item)
{
    const size = (item.UsageData === null) || (item.UsageData === undefined) ? -1 : item.UsageData.Size;
    return ((typeof size === 'number') && (size >= 0)) ? size : null;
}

// The name compose made the container from, else the image's first tag, else its short id
function image_name(container, image, id)
{
    if ((typeof container.Image === 'string') && (bare_id(container.Image) !== id) && (container.Image !== '')) {
        return container.Image;
    }
    const tags = ((image === undefined) || (Array.isArray(image.RepoTags) === false)) ? [] : image.RepoTags.filter(v => (v !== '<none>:<none>') && (v !== '<none>'));
    return (tags.length > 0) ? tags[0] : id.slice(0, 12);
}

function users_add(users, name, key)
{
    if (name === '') {
        return;
    }
    if (users.has(name) === false) {
        users.set(name, new Set());
    }
    users.get(name).add(key);
}

// The other projects that use it, by name; null for the containers in none, last
function users_other(users, name, key)
{
    const others = Array.from(users.has(name) ? users.get(name) : []).filter(v => (v !== key)).sort();
    return others.filter(v => (v !== '')).concat(others.includes('') ? [null] : []);
}

// The sizes known added, null when none is
function sum(values)
{
    const known = values.filter(v => (typeof v === 'number'));
    return (known.length === 0) ? null : known.reduce((total, v) => total + v, 0);
}

// What every image takes, each layer once: docker says it as LayersSize; podman says 0 there,
// and then the images' sizes are added, their shared layers more than once
function images_total(df, images)
{
    if ((typeof df.LayersSize === 'number') && (df.LayersSize > 0)) {
        return df.LayersSize;
    }
    return sum(Array.from(images.values()).map(v => v.Size)) || 0;
}

// What the images no container was made from take, as `docker system df` says it can be
// reclaimed: everything, less what each image a container uses has to itself
function images_unused(df, images, image_users)
{
    const used = Array.from(images.values()).filter(v => image_users.has(bare_id(v.Id)));
    const unused = Array.from(images.values()).filter(v => (image_users.has(bare_id(v.Id)) === false));
    if ((typeof df.LayersSize === 'number') && (df.LayersSize > 0) && used.every(v => (v.SharedSize >= 0))) {
        return Math.max(0, df.LayersSize - used.reduce((total, v) => total + v.Size - v.SharedSize, 0));
    }
    return sum(unused.map(v => v.Size)) || 0;
}

// The build cache, the records it shares with images left out, as `docker system df` says it
function build_cache(df)
{
    if (Array.isArray(df.BuildCache) && (df.BuildCache.length > 0)) {
        return df.BuildCache.filter(v => (v.Shared !== true)).reduce((total, v) => total + (v.Size || 0), 0);
    }
    return (typeof df.BuilderSize === 'number') ? df.BuilderSize : 0;
}

// Why some folder was not counted: the first reason, and how many more
function folders_missing(folders)
{
    const errors = Array.from(folders.values()).filter(v => (v.error !== undefined)).map(v => v.error);
    if (errors.length === 0) {
        return null;
    }
    return (errors.length === 1) ? errors[0] : `${errors[0]} (and ${errors.length - 1} more)`;
}

module.exports = docker_disk;
