const assert = require('assert');
const docker_disk = require('../server/docker_disk');
const test = require('node:test');

const MB = 1000*1000;

// Two projects made from one image, a third of its own, and a container in none; a volume
// compose made and no container mounts, one of another driver docker cannot weigh; an earlier
// pull of the two projects' image, its tag moved on, its digest still naming its repository
function machine()
{
    const web = {'com.docker.compose.project': 'shop', 'com.docker.compose.project.working_dir': '/srv/shop'};
    const staging = {'com.docker.compose.project': 'shop-staging', 'com.docker.compose.project.working_dir': '/srv/shop-staging'};
    const blog = {'com.docker.compose.project': 'blog', 'com.docker.compose.project.working_dir': '/srv/blog'};
    const containers = [
        {Id: 'a'.repeat(64), Image: 'registry.example.com/shop/web:1.4', ImageID: `sha256:${'1'.repeat(64)}`, Labels: web, Mounts: [{Type: 'volume', Name: 'shop_data'}, {Type: 'bind', Source: '/srv/shop/uploads'}]},
        {Id: 'b'.repeat(64), Image: 'registry.example.com/shop/web:1.4', ImageID: `sha256:${'1'.repeat(64)}`, Labels: web, Mounts: [{Type: 'volume', Name: 'shop_data'}]},
        {Id: 'c'.repeat(64), Image: 'registry.example.com/shop/web:1.4', ImageID: `sha256:${'1'.repeat(64)}`, Labels: staging, Mounts: [{Type: 'volume', Name: 'nfs_media'}]},
        {Id: 'd'.repeat(64), Image: `sha256:${'2'.repeat(64)}`, ImageID: `sha256:${'2'.repeat(64)}`, Labels: blog, Mounts: []},
        {Id: 'e'.repeat(64), Image: 'busybox', ImageID: `sha256:${'3'.repeat(64)}`, Labels: null},
    ];
    // docker leaves SizeRw out where a container wrote nothing
    const df = {
        LayersSize: 1500*MB,
        Images: [
            {Id: `sha256:${'1'.repeat(64)}`, RepoTags: ['registry.example.com/shop/web:1.4'], Size: 900*MB, SharedSize: 80*MB},
            {Id: `sha256:${'2'.repeat(64)}`, RepoTags: ['ghost/blog:5'], Size: 400*MB, SharedSize: 80*MB},
            {Id: `sha256:${'3'.repeat(64)}`, RepoTags: ['busybox:latest'], Size: 4*MB, SharedSize: 0},
            {Id: `sha256:${'4'.repeat(64)}`, RepoTags: ['<none>:<none>'], RepoDigests: ['registry.example.com/shop/web@sha256:abc'], Size: 300*MB, SharedSize: 20*MB},
        ],
        Containers: [
            {Id: 'a'.repeat(64), SizeRw: 30*MB},
            {Id: 'b'.repeat(64), SizeRw: 2*MB},
            {Id: 'c'.repeat(64)},
            {Id: 'd'.repeat(64), SizeRw: 120*MB},
            {Id: 'e'.repeat(64), SizeRw: 0},
        ],
        Volumes: [
            {Name: 'shop_data', Labels: {'com.docker.compose.project': 'shop'}, UsageData: {Size: 700*MB, RefCount: 2}},
            {Name: 'shop_cache', Labels: {'com.docker.compose.project': 'shop'}, UsageData: {Size: 50*MB, RefCount: 0}},
            {Name: 'nfs_media', Labels: null, UsageData: {Size: -1, RefCount: 1}},
        ],
        BuildCache: [{Size: 200*MB, Shared: false}, {Size: 900*MB, Shared: true}],
    };
    return {df, containers};
}

// Each project's parts: its image once however many containers run it, what each container
// wrote, its volumes (one compose made and nothing mounts too), its logs, its folder
test('each compose project\'s disk: image, written, volumes, logs and folder, the shared ones said', function () {
    const {df, containers} = machine();
    const logs = {sizes: new Map([['a'.repeat(64), 5*MB], ['b'.repeat(64), 1*MB], ['d'.repeat(64), 2*MB]])};
    const folders = new Map([['/srv/shop', {size: 40*MB, unread: 1}], ['/srv/shop-staging', {size: 1*MB, unread: 0}], ['/srv/blog', {error: 'only root may read /srv/blog'}]]);
    const disk = docker_disk(df, containers, logs, folders);

    assert.deepStrictEqual(disk.projects.map(v => v.project), ['blog', 'shop', 'shop-staging', null]);
    const [blog, shop, staging, alone] = disk.projects;
    assert.deepStrictEqual(shop.parts, {image: 900*MB, old: 280*MB, written: 32*MB, volumes: 750*MB, logs: 6*MB, folder: 40*MB});
    assert.deepStrictEqual([shop.total, shop.unread, shop.dir], [2008*MB, 1, '/srv/shop']);
    assert.deepStrictEqual(shop.images, [{id: '1'.repeat(64), name: 'registry.example.com/shop/web:1.4', size: 900*MB, shared: ['shop-staging']}]);
    // The earlier pull: what removing it frees, its layers shared with others left out
    assert.deepStrictEqual(shop.old, [{id: '4'.repeat(64), name: `registry.example.com/shop/web (${'4'.repeat(12)})`, size: 280*MB, shared: ['shop-staging']}]);
    assert.deepStrictEqual(shop.volumes, [{name: 'shop_cache', size: 50*MB, shared: []}, {name: 'shop_data', size: 700*MB, shared: []}]);

    // A volume docker could not weigh is no size; a container that wrote nothing wrote 0
    assert.deepStrictEqual(staging.parts, {image: 900*MB, old: 280*MB, written: 0, volumes: null, logs: 0, folder: 1*MB});
    assert.deepStrictEqual(staging.volumes, [{name: 'nfs_media', size: null, shared: []}]);
    // An image a container names by its id is called by its tag; a folder not counted is null
    assert.deepStrictEqual([blog.images[0].name, blog.parts.folder, blog.parts.old, blog.total], ['ghost/blog:5', null, 0, 522*MB]);
    assert.deepStrictEqual([alone.dir, alone.parts.image, alone.parts.folder], [null, 4*MB, null]);

    assert.deepStrictEqual(disk.containers['a'.repeat(64)], {written: 30*MB, log: 5*MB});
    assert.deepStrictEqual(disk.containers['e'.repeat(64)], {written: 0, log: null});
    assert.deepStrictEqual(disk.volumes, {shop_data: 700*MB, shop_cache: 50*MB, nfs_media: null});
    // The machine's: images each layer once, as docker says it; unused as docker system df
    // reclaims it; the build cache without what it shares with images
    assert.deepStrictEqual(disk.totals, {images: 1500*MB, images_unused: (1500 - 820 - 320 - 4)*MB, written: 152*MB, volumes: 750*MB, logs: 8*MB, folders: 41*MB, build_cache: 200*MB});
    assert.deepStrictEqual(disk.missing, {logs: null, folders: 'only root may read /srv/blog'});
});

// An image a project shares with containers in none says so; logs not counted are no number
// anywhere, and why is said once
test('logs not counted are null, and why; an image shared with containers in no project', function () {
    const {df, containers} = machine();
    containers[4].ImageID = containers[3].ImageID;
    const disk = docker_disk(df, containers, {error: 'only root may read /var/lib/docker/containers'}, new Map());
    const blog = disk.projects.find(v => v.project === 'blog');
    assert.deepStrictEqual(blog.images[0].shared, [null]);
    assert.deepStrictEqual([blog.parts.logs, disk.totals.logs, disk.totals.folders, disk.containers['d'.repeat(64)].log], [null, null, null, null]);
    assert.deepStrictEqual(disk.missing, {logs: 'only root may read /var/lib/docker/containers', folders: null});
});

// podman: ids without sha256:, no LayersSize, its build cache as one number, its containers'
// folders under overlay-containers
test('podman\'s answer: bare ids, the images added up, its own folder for containers', function () {
    const df = {
        LayersSize: 0,
        Images: [{Id: '1'.repeat(64), RepoTags: ['24.04'], Size: 80*MB, SharedSize: 80*MB}, {Id: '2'.repeat(64), RepoTags: ['12'], Size: 120*MB, SharedSize: 0}],
        Containers: [{Id: 'a'.repeat(64), SizeRw: 30*MB, Mounts: null}],
        Volumes: [{Name: 'shop_data', Labels: {}, UsageData: {Size: 20*MB, RefCount: 1}}],
        BuildCache: [],
        BuilderSize: 0,
    };
    const containers = [{Id: 'a'.repeat(64), Image: 'docker.io/library/ubuntu:24.04', ImageID: '1'.repeat(64), Labels: {'com.docker.compose.project': 'shop'}, Mounts: [{Type: 'volume', Name: 'shop_data'}]}];
    const disk = docker_disk(df, containers, {sizes: new Map()}, new Map());
    assert.deepStrictEqual(disk.projects[0].parts, {image: 80*MB, old: 0, written: 30*MB, volumes: 20*MB, logs: 0, folder: null});
    assert.deepStrictEqual([disk.totals.images, disk.totals.images_unused, disk.totals.build_cache], [200*MB, 120*MB, 0]);

    const version_podman = {Components: [{Name: 'Podman Engine'}]};
    assert.strictEqual(docker_disk.logs_folder({DockerRootDir: '/home/user/.local/share/containers/storage'}, version_podman), '/home/user/.local/share/containers/storage/overlay-containers');
    assert.strictEqual(docker_disk.logs_folder({DockerRootDir: '/var/lib/docker'}, {Components: [{Name: 'Engine'}]}), '/var/lib/docker/containers');
    assert.strictEqual(docker_disk.logs_folder({}, {}), null);
    const counted = {folders: [{path: `/var/lib/docker/containers/${'a'.repeat(64)}`, size: 5*MB}, {path: '/var/lib/docker/containers/tmp', size: 1}]};

    // One repository however it is written: an older tag of the same, by its tag; another
    // repository, an image a stopped container still needs, the one it runs, and a newer pull of
    // the name it runs that up has not started from yet: none of them old
    const images = [
        {Id: '1'.repeat(64), RepoTags: ['docker.io/library/postgres:17'], Size: 400*MB},
        {Id: '2'.repeat(64), RepoTags: ['postgres:16'], Size: 390*MB, SharedSize: -1},
        {Id: '3'.repeat(64), RepoTags: ['postgres-tools:1'], Size: 50*MB},
        {Id: '5'.repeat(64), RepoTags: ['postgres:15'], Size: 380*MB},
        // A pull of the very name the project runs, that up has not used yet
        {Id: '6'.repeat(64), RepoTags: ['docker.io/library/postgres:17-alpine'], Size: 90*MB},
    ];
    const running = [
        {Id: 'a'.repeat(64), Image: 'postgres:17', ImageID: '1'.repeat(64), Labels: {'com.docker.compose.project': 'db'}},
        {Id: 'c'.repeat(64), Image: 'postgres:17-alpine', ImageID: '9'.repeat(64), Labels: {'com.docker.compose.project': 'db'}},
        {Id: 'b'.repeat(64), Image: 'postgres:15', ImageID: '5'.repeat(64), State: 'exited', Labels: {}},
    ];
    assert.deepStrictEqual(docker_disk.old_images(images, running, 'db'), [{id: '2'.repeat(64), name: 'postgres:16', size: 390*MB}]);
    assert.deepStrictEqual(Array.from(docker_disk.log_sizes(counted)), [['a'.repeat(64), 5*MB]]);
});
