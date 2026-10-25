const assert = require('assert');
const fs = require('fs');
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

test('the agent image installs what its bundler needs before it bundles, and the repository carries no stale agent file', function () {
    const image = read('Dockerfile.agent');
    assert.ok(image.indexOf('RUN npm ci --omit=dev') < image.indexOf('RUN node src/agent/bin/build'));
    assert.match(image, /COPY package\.json package-lock\.json \.\//);
    assert.strictEqual(fs.existsSync(path.join(ROOT, 'serviceman-agent.js')), false, 'the agent comes from the host, /api/v1/agent.js');
    assert.ok(read('.gitignore').split('\n').includes('serviceman-agent.js'));
    assert.strictEqual(fs.existsSync(path.join(ROOT, 'src', 'agent', 'doors', 'table.json')), false, 'a run from the repository writes its table under data/');
    assert.doesNotMatch(read('bin/release'), /git add .*serviceman-agent\.js/);
});
