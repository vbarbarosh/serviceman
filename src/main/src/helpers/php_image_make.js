const docker_exec_connect = require('./docker_exec_connect');
const engine_call = require('./engine_call');
const engine_said = require('./engine_said');
const log_event = require('./log_event');
const service_said = require('./service_said');
const tar_stream = require('./tar_stream');

// serviceman's PHP: the official image with the drivers of the databases serviceman runs, made
// on the machine that runs a PHP app, once, the first time one starts there
const IMAGE = 'serviceman-php:8.4';
const DOCKERFILE = `FROM docker.io/library/php:8.4-cli
RUN apt-get update \\
    && apt-get install -y --no-install-recommends libpq-dev \\
    && docker-php-ext-install mysqli pdo_mysql pgsql pdo_pgsql \\
    && rm -rf /var/lib/apt/lists/*
LABEL serviceman.image="php"
`;

// Made through the machine's Engine API from that Dockerfile, which pulls PHP and builds its
// drivers: a minute or two, said on the page waiting for it. Answers whether it had to; a build
// that fails throws what docker said, and the start fails with it.
async function php_image_make(app, remote, service)
{
    const connect = docker_exec_connect(app, remote);
    const there = await engine_call(connect, 'GET', `/images/${encodeURIComponent(IMAGE)}/json`);
    if (there.status === 200) {
        return false;
    }
    const begun = Date.now();
    log_event(app, 'php_image_begin', {service: service.name, image: IMAGE, remote: remote.name});
    service_said(app, {service: service.name, text: `making ${IMAGE} on ${remote.name}, once: PHP with the drivers of MySQL and PostgreSQL, a minute or two`});
    service.state.doing = `making ${IMAGE}`;
    try {
        const context = Buffer.concat(await tar_stream([{path: 'Dockerfile', mode: 0o644, mtime_s: Math.floor(Date.now()/1000), size: Buffer.byteLength(DOCKERFILE), stream: () => [Buffer.from(DOCKERFILE)]}]).toArray());
        const built = await engine_call(connect, 'POST', `/build?t=${encodeURIComponent(IMAGE)}&rm=1&forcerm=1`, context, 'application/x-tar');
        if (built.status !== 200) {
            throw new Error(engine_said(built));
        }
        // A build that fails says so as the last of its lines, with an answer of 200 all the same
        for (const line of built.body.split('\n')) {
            let said = null;
            try {
                said = JSON.parse(line);
            }
            catch {
                continue;
            }
            if ((said.error !== undefined) || (said.errorDetail !== undefined)) {
                throw new Error(`docker could not make ${IMAGE}: ${said.error || said.errorDetail.message}`);
            }
        }
        log_event(app, 'php_image_end_ok', {service: service.name, image: IMAGE, remote: remote.name, ms: Date.now() - begun});
        return true;
    }
    catch (error) {
        log_event(app, 'php_image_end_error', {service: service.name, image: IMAGE, remote: remote.name, reason: error.message, ms: Date.now() - begun});
        throw error;
    }
    finally {
        service.state.doing = null;
    }
}

php_image_make.IMAGE = IMAGE;

module.exports = php_image_make;
