const assert = require('assert');
const fs = require('fs');
const module_builtin = require('module');
const path = require('path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

function read(file)
{
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

// What the image is built from and run with: no .env baked in, the state on the volume the
// image writes to, no secret on the docker command line, and an agent image that builds
test('the build leaves every .env and data out, and bin/build refuses a checkout with one in it', function () {
    const ignored = read('.dockerignore').split('\n');
    for (const name of ['.env', '**/.env', '**/data', 'data']) {
        assert.ok(ignored.includes(name), `${name} in .dockerignore`);
    }
    assert.match(read('bin/build'), /for env_file in \.env logline\/\.env logline\/lines\/\.env; do/);
    assert.match(read('bin/build'), /would go into the image/);
});

test('the compose demo and the entrypoint keep the state where the image writes it, /app/data', function () {
    assert.match(read('demos/docker-compose.yml'), /- data:\/app\/data/);
    assert.doesNotMatch(read('demos/docker-compose.yml'), /- data:\/data\b/);
    const entrypoint = read('docker-entrypoint.sh');
    assert.match(entrypoint, /CONFIG=\$\{SERVICEMAN_CONFIG:-\/app\/data\/serviceman\.json\}/);
    assert.doesNotMatch(entrypoint, /mkdir -p \/data /);
});

test('bin/run hands the two secrets to docker by name, not on its command line', function () {
    const run = read('bin/run');
    assert.match(run, /-e TS_AUTHKEY \\/);
    assert.match(run, /-e SERVICEMAN_OWNER_TOKEN \\/);
    assert.doesNotMatch(run, /TS_AUTHKEY=\$\{|SERVICEMAN_OWNER_TOKEN=\$\{/);
});

// An image is given a few folders of the repository, not all of it. A file its program
// requires that is in none of them ends the container at its first line, or the build at its
// bundler: the Terminal module came to require a helper of src/helpers that web-terminal's
// image was not given, and the agent a file of the File Manager module that the agent's was not.
test('every image is given each file its program requires, and web-terminal\'s each package', function () {
    const images = [
        {image: 'Dockerfile', entry: 'src/main/index.js', base: ''},
        {image: 'Dockerfile.agent', entry: 'src/agent/index.js', base: ''},
        {image: 'src/web-terminal/Dockerfile', entry: 'src/web-terminal/index.js', base: ''},
        {image: 'logline/lines/Dockerfile', entry: 'logline/lines/index.js', base: 'logline/lines'},
    ];
    for (const item of images) {
        const copied = [...read(item.image).matchAll(/^COPY (?!--from)(.+) \S+$/gm)].flatMap(v => v[1].split(/\s+/));
        const required = {files: new Set(), packages: new Set()};
        requires_walk(path.join(ROOT, item.entry), required);
        const files = [...required.files].map(v => path.relative(path.join(ROOT, item.base), v));
        assert.ok(files.length > 10, `${item.image}: the walk follows the program's requires`);
        assert.deepStrictEqual(files.filter(v => copied.some(vv => (v === vv) || v.startsWith(`${vv}/`)) === false), [], item.image);
        // web-terminal's image installs with --omit=dev: what its program requires is a
        // dependency proper
        if (item.image === 'src/web-terminal/Dockerfile') {
            const installed = Object.keys(JSON.parse(read('package.json')).dependencies);
            assert.deepStrictEqual([...required.packages].filter(v => installed.includes(v) === false), []);
        }
    }
});

test('the agent image installs what its bundler needs before it bundles, and the repository carries no stale agent file', function () {
    const image = read('Dockerfile.agent');
    assert.ok(image.indexOf('RUN npm ci --omit=dev') < image.indexOf('RUN node src/agent/bin/build'));
    assert.match(image, /COPY package\.json package-lock\.json \.\//);
    assert.strictEqual(fs.existsSync(path.join(ROOT, 'serviceman-agent.js')), false, 'the agent comes from the host, /api/v1/agent.js');
    assert.ok(read('.gitignore').split('\n').includes('serviceman-agent.js'));
    assert.strictEqual(fs.existsSync(path.join(ROOT, 'src', 'agent', 'doors', 'table.json')), false, 'a run from the repository writes its table under data/');
    assert.doesNotMatch(read('bin/release'), /git add .*serviceman-agent\.js/);
});

// Every file a program requires by a path of its own, each followed in turn, and every package
// it requires by name: {files, packages}, filled in
function requires_walk(file, required)
{
    if (required.files.has(file)) {
        return;
    }
    required.files.add(file);
    if (file.endsWith('.js') === false) {
        return;
    }
    for (const found of fs.readFileSync(file, 'utf8').matchAll(/require\('([^']+)'\)/g)) {
        const name = found[1];
        if (name.startsWith('.')) {
            requires_walk(require.resolve(path.resolve(path.dirname(file), name)), required);
        }
        else if ((name.startsWith('node:') === false) && (module_builtin.builtinModules.includes(name) === false)) {
            required.packages.add(name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/'));
        }
    }
}
