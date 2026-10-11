const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const docker_argv_from_service = require('../src/main/src/helpers/docker_argv_from_service');
const docker_spec_hash = require('../src/main/src/helpers/docker_spec_hash');
const duration_ms_from_text = require('../src/main/src/helpers/duration_ms_from_text');
const file_log_from_env = require('../src/main/src/helpers/file_log_from_env');
const route_from_request = require('../src/main/src/routes/route_from_request');
const test = require('node:test');
const upstream_from_text = require('../src/main/src/helpers/upstream_from_text');

// The one machine these configs name: a container has to run somewhere with an agent
const REMOTES = [{name: 'vps1', token: '0123456789abcdef0123456789abcdef'}];

test('a duration reads as a number of milliseconds', function () {
    assert.strictEqual(duration_ms_from_text('30s', 'x'), 30000);
    assert.strictEqual(duration_ms_from_text('10m', 'x'), 600000);
    assert.strictEqual(duration_ms_from_text('2h', 'x'), 7200000);
    assert.strictEqual(duration_ms_from_text(90, 'x'), 90000);
    assert.strictEqual(duration_ms_from_text(null, 'x'), null);
    assert.strictEqual(duration_ms_from_text(false, 'x'), null);
    assert.throws(() => duration_ms_from_text('soon', 'policy.stop_after_idle'), /policy.stop_after_idle/);
});

test('the defaults of a service are the serviceman defaults', function () {
    const config = config_from_json({remotes: REMOTES, services: [{name: 'a', type: 'docker', remote: 'vps1', publish: {host: 'a.test', port: 80}, image: 'nginx'}]}, '/srv');
    const service = config.services[0];
    assert.strictEqual(config.listen.port, 8080);
    assert.deepStrictEqual(service.remotes, ['vps1']);
    assert.strictEqual(config.control.host, 'serviceman.localhost');
    assert.strictEqual(service.policy.start, 'on_demand');
    assert.strictEqual(service.policy.stop_after_idle_ms, 600000);
    assert.strictEqual(service.policy.start_timeout_ms, 120000);
    assert.strictEqual(service.policy.request_timeout_ms, 60000);
    assert.strictEqual(service.policy.scale_down_after_ms, 120000);
    assert.deepStrictEqual(service.policy.instances, {min: 0, max: 1});
    assert.strictEqual(service.policy.concurrency, null);
    assert.deepStrictEqual(service.policy.warmup, {queue: 1, wait_ms: 2000});
});

test('the scaling policy is read, and nonsense is refused', function () {
    const config = config_from_json({
        remotes: REMOTES,
        defaults: {concurrency: 8, instances: {max: 4}},
        services: [
            {name: 'a', type: 'docker', remote: 'vps1', publish: {host: 'a.test', port: 80}, image: 'x', policy: {instances: {min: 1}, warmup: {queue: 3, wait: '500ms'}, request_timeout: false}},
            {name: 'b', type: 'docker', remote: 'vps1', publish: {host: 'b.test', port: 80}, image: 'x', policy: {concurrency: false}},
        ],
    }, '/srv');
    assert.deepStrictEqual(config.services[0].policy.instances, {min: 1, max: 4});
    assert.strictEqual(config.services[0].policy.concurrency, 8);
    assert.deepStrictEqual(config.services[0].policy.warmup, {queue: 3, wait_ms: 500});
    assert.strictEqual(config.services[0].policy.request_timeout_ms, null);
    assert.strictEqual(config.services[1].policy.concurrency, null);

    function bad(policy) {
        return function () {
            return config_from_json({remotes: REMOTES, services: [{name: 'a', type: 'docker', remote: 'vps1', publish: {host: 'a.test', port: 80}, image: 'x', policy}]}, '/srv');
        };
    }
    assert.throws(bad({instances: {min: 3, max: 2}}), /min is above max/);
    assert.throws(bad({instances: {max: 0}}), /instances.max/);
    assert.throws(bad({concurrency: 0}), /concurrency/);
    assert.throws(bad({warmup: {queue: 0}}), /warmup.queue/);
});

test('the defaults block moves every service at once', function () {
    const config = config_from_json({
        remotes: REMOTES,
        defaults: {stop_after_idle: '45s', start: 'always'},
        services: [
            {name: 'a', type: 'docker', remote: 'vps1', publish: {host: 'a.test', port: 80}, image: 'nginx'},
            {name: 'b', type: 'docker', remote: 'vps1', publish: {host: 'b.test', port: 80}, image: 'nginx', policy: {start: 'on_demand', stop_after_idle: false}},
        ],
    }, '/srv');
    assert.strictEqual(config.services[0].policy.start, 'always');
    assert.strictEqual(config.services[0].policy.stop_after_idle_ms, 45000);
    assert.strictEqual(config.services[1].policy.start, 'on_demand');
    assert.strictEqual(config.services[1].policy.stop_after_idle_ms, null);
});

test('a container and a program name the machine they run on; what already runs names none', function () {
    function bad(json) {
        return function () {
            return config_from_json({remotes: REMOTES, services: [json]}, '/srv');
        };
    }
    assert.throws(bad({name: 'a', type: 'docker', publish: {host: 'a.test', port: 80}, image: 'x'}), /services\[0\].remotes: a docker service runs on a machine with an agent — name one, or a #tag/);
    assert.throws(bad({name: 'a', type: 'shell', command: 'sleep 1', policy: {start: 'always'}}), /a shell service runs on a machine with an agent/);
    assert.throws(bad({name: 'a', type: 'external', remotes: ['vps1'], publish: {host: 'a.test'}, upstream: '127.0.0.1:7000'}), /services\[0\]\.remote: an external service runs where it already runs — name the one machine it is on/);
    assert.throws(bad({name: 'a', type: 'docker', remote: 'vps9', publish: {host: 'a.test', port: 80}, image: 'x'}), /no remote named "vps9" is in the config/);

    const fine = config_from_json({remotes: REMOTES, services: [
        {name: 'a', type: 'docker', remote: 'vps1', publish: {host: 'a.test', port: 80}, image: 'x'},
        {name: 'b', type: 'docker', remotes: ['vps1', '#gpu'], publish: {host: 'b.test', port: 80}, image: 'x'},
        {name: 'c', type: 'external', publish: {host: 'c.test'}, upstream: '127.0.0.1:7000'},
    ]}, '/srv');
    assert.deepStrictEqual(fine.services.map(v => v.remotes), [['vps1'], ['vps1', '#gpu'], []]);
    // The machine serviceman runs on is a remote like any other — only its agent makes it one
    assert.deepStrictEqual(app_from_config(fine).remotes.map(v => v.name), ['vps1']);
});

test('a config that would only fail at the first request is refused', function () {
    function bad(json) {
        return function () {
            return config_from_json(json, '/srv');
        };
    }
    assert.throws(bad({services: [{name: 'a', type: 'lxc', publish: {host: 'a.test'}}]}), /type/);
    assert.throws(bad({services: [{name: 'a', type: 'docker', remote: 'vps1', publish: {host: 'a.test', port: 80}}]}), /image/);
    assert.throws(bad({services: [{name: 'a', type: 'docker', remote: 'vps1', publish: {host: 'a.test'}, image: 'nginx'}]}), /port/);
    assert.throws(bad({services: [{name: 'a', type: 'external', publish: {host: 'A.Test'}, upstream: '127.0.0.1:7000'}]}), /lowercase/);
    assert.throws(bad({services: [{name: 'a', type: 'external', publish: {host: 'a.test:8080'}, upstream: '127.0.0.1:7000'}]}), /no port/);
    assert.throws(bad({services: [{name: 'a', type: 'external', upstream: '127.0.0.1:7000'}]}), /hostname/);
    assert.throws(bad({services: [
        {name: 'a', type: 'external', publish: {host: 'a.test'}, upstream: '127.0.0.1:7000'},
        {name: 'a', type: 'external', publish: {host: 'b.test'}, upstream: '127.0.0.1:7000'},
    ]}), /used twice/);
    assert.throws(bad({services: [
        {name: 'a', type: 'external', publish: {host: 'a.test'}, upstream: '127.0.0.1:7000'},
        {name: 'b', type: 'external', publish: {host: 'a.test'}, upstream: '127.0.0.1:7000'},
    ]}), /used twice/);
    assert.throws(bad({services: [{name: 'a', type: 'external', publish: {host: 'serviceman.localhost'}, upstream: '127.0.0.1:7000'}]}), /the control page hostname/);
});

test('a hostname finds its service, wildcards after the exact names', function () {
    const config = config_from_json({remotes: REMOTES, services: [
        {name: 'one', type: 'external', publish: {host: 'one.test'}, upstream: '127.0.0.1:7000'},
        {name: 'rest', type: 'external', publish: {host: '*.test'}, upstream: '127.0.0.1:7000'},
    ]}, '/srv');
    const app = app_from_config(config);
    assert.strictEqual(route_from_request(app, 'one.test', '/').service.name, 'one');
    assert.strictEqual(route_from_request(app, 'ONE.test:8080', '/').service.name, 'one');
    assert.strictEqual(route_from_request(app, 'two.test', '/').service.name, 'rest');
    assert.strictEqual(route_from_request(app, 'nothing.example', '/'), null);
});

test('a path prefix finds its service, the longest prefix first', function () {
    const config = config_from_json({remotes: REMOTES, services: [
        {name: 'pdf', type: 'external', publish: {host: 'tools.test/pdf'}, upstream: '127.0.0.1:7000'},
        {name: 'pdf_v2', type: 'external', publish: {host: 'tools.test/pdf/v2'}, upstream: '127.0.0.1:7000'},
        {name: 'root', type: 'external', publish: {host: 'tools.test'}, upstream: '127.0.0.1:7000'},
        {name: 'wild', type: 'external', publish: {host: '*.test/pdf'}, upstream: '127.0.0.1:7000'},
    ]}, '/srv');
    const app = app_from_config(config);
    assert.strictEqual(route_from_request(app, 'tools.test', '/pdf').service.name, 'pdf');
    assert.strictEqual(route_from_request(app, 'tools.test', '/pdf/one.pdf').service.name, 'pdf');
    assert.strictEqual(route_from_request(app, 'tools.test', '/pdf/v2/one.pdf').service.name, 'pdf_v2');
    assert.strictEqual(route_from_request(app, 'tools.test', '/pdfx').service.name, 'root');
    assert.strictEqual(route_from_request(app, 'tools.test', '/img').service.name, 'root');
    assert.strictEqual(route_from_request(app, 'other.test', '/pdf/one.pdf').service.name, 'wild');
    assert.strictEqual(route_from_request(app, 'other.test', '/img'), null);
    assert.strictEqual(route_from_request(app, 'tools.test', '/pdf').path, '/pdf');
});

test('the same hostname with two path prefixes is fine, the same claim twice is refused', function () {
    const both = config_from_json({remotes: REMOTES, services: [
        {name: 'one', type: 'external', publish: {host: 'tools.test/pdf'}, upstream: '127.0.0.1:7000'},
        {name: 'two', type: 'external', publish: {host: 'tools.test/img'}, upstream: '127.0.0.1:7000'},
    ]}, '/srv');
    assert.strictEqual(both.services.length, 2);
    assert.deepStrictEqual(both.services[0].routes, [{host: 'tools.test', path: '/pdf'}]);

    assert.throws(function () {
        config_from_json({remotes: REMOTES, services: [
            {name: 'one', type: 'external', publish: {host: 'tools.test/pdf'}, upstream: '127.0.0.1:7000'},
            {name: 'two', type: 'external', publish: {hosts: ['tools.test/pdf/']}, upstream: '127.0.0.1:7000'},
        ]}, '/srv');
    }, /is used twice/);
    assert.throws(function () {
        config_from_json({remotes: REMOTES, services: [
            {name: 'one', type: 'external', publish: {host: 'serviceman.localhost/pdf'}, upstream: '127.0.0.1:7000'},
        ]}, '/srv');
    }, /the control page hostname/);
    assert.throws(function () {
        config_from_json({remotes: REMOTES, services: [
            {name: 'one', type: 'external', publish: {host: 'tools.test/pdf?x=1'}, upstream: '127.0.0.1:7000'},
        ]}, '/srv');
    }, /no query, hash or spaces/);
});

test('the docker command line carries the ports, the env and the labels', function () {
    const config = config_from_json({remotes: REMOTES, services: [{
        name: 'app',
        type: 'docker',
        remote: 'vps1',
        publish: {host: 'app.test', port: 3000},
        image: 'demo/app:2',
        env: {TZ: 'UTC'},
        volumes: ['/srv/data:/data'],
        network: 'backend',
        run_args: ['--memory', '512m'],
        args: ['--verbose'],
    }]}, '/srv');
    const argv = docker_argv_from_service(config.services[0], 1);
    assert.deepStrictEqual(argv, [
        'run', '-d', '--init',
        '--name', 'serviceman-app',
        '--label', 'serviceman.service=app',
        '--label', `serviceman.spec=${docker_spec_hash(config.services[0])}`,
        '--publish', '127.0.0.1::3000',
        '--env', 'TZ=UTC',
        '--volume', '/srv/data:/data',
        '--network', 'backend',
        '--memory', '512m',
        'demo/app:2',
        '--verbose',
    ]);
});

test('an image that has to be pid 1 itself is run without the init, and that changes its container', function () {
    const plain = config_from_json({remotes: REMOTES, services: [{name: 'a', type: 'docker', remote: 'vps1', publish: {host: 'a.test', port: 80}, image: 'x'}]}, '/srv').services[0];
    const own = config_from_json({remotes: REMOTES, services: [{name: 'a', type: 'docker', remote: 'vps1', publish: {host: 'a.test', port: 80}, image: 'x', init: false}]}, '/srv').services[0];
    assert.strictEqual(plain.init, true);
    assert.ok(docker_argv_from_service(plain, 1).includes('--init'));
    assert.strictEqual(docker_argv_from_service(own, 1).includes('--init'), false);
    assert.notStrictEqual(docker_spec_hash(own), docker_spec_hash(plain), 'the container is made again without it');
});

test('the address docker answers with is read back', function () {
    assert.deepStrictEqual(upstream_from_text('127.0.0.1:49153'), {host: '127.0.0.1', port: 49153});
    assert.deepStrictEqual(upstream_from_text('0.0.0.0:49153\n[::]:49153'), {host: '127.0.0.1', port: 49153});
    assert.deepStrictEqual(upstream_from_text('[::]:8080'), {host: '127.0.0.1', port: 8080});
    assert.strictEqual(upstream_from_text(''), null);
});

test('storage lines are read as strings or as objects', function () {
    const config = config_from_json({remotes: REMOTES, services: [{
        name: 'app',
        type: 'docker',
        remote: 'vps1',
        publish: {host: 'app.test', port: 80},
        image: 'demo/app',
        volumes: [
            'app-data:/var/lib/app',
            '/srv/app/files:/files:ro',
            'data/uploads:/uploads',
            {source: 'cache', target: '/cache'},
            {source: '/srv/app/conf', target: '/etc/app', readonly: true, create: false},
        ],
    }]}, '/srv/serviceman');
    assert.deepStrictEqual(config.services[0].volumes, [
        {kind: 'volume', source: 'app-data', target: '/var/lib/app', readonly: false, create: false},
        {kind: 'path', source: '/srv/app/files', target: '/files', readonly: true, create: true},
        {kind: 'path', source: '/srv/serviceman/data/uploads', target: '/uploads', readonly: false, create: true},
        {kind: 'volume', source: 'cache', target: '/cache', readonly: false, create: false},
        {kind: 'path', source: '/srv/app/conf', target: '/etc/app', readonly: true, create: false},
    ]);
});

test('a storage line that docker would refuse is refused here', function () {
    function bad(volumes) {
        return function () {
            return config_from_json({remotes: REMOTES, services: [{name: 'a', type: 'docker', remote: 'vps1', publish: {host: 'a.test', port: 80}, image: 'x', volumes}]}, '/srv');
        };
    }
    assert.throws(bad(['/srv/app']), /source:target/);
    assert.throws(bad(['/srv/app:data']), /starts with \//);
    assert.throws(bad(['/srv/app:/data:rx']), /source:target/);
    assert.throws(bad([{target: '/data'}]), /source/);
    assert.throws(bad([{source: 'x'}]), /target/);
    assert.throws(bad('/srv/app:/data'), /list of volumes/);
});

test('the storage lines reach the docker command line', function () {
    const config = config_from_json({remotes: REMOTES, services: [{
        name: 'app',
        type: 'docker',
        remote: 'vps1',
        publish: {host: 'app.test', port: 80},
        image: 'demo/app',
        volumes: ['app-data:/var/lib/app', '/srv/conf:/etc/app:ro'],
    }]}, '/srv');
    const argv = docker_argv_from_service(config.services[0], 1);
    assert.ok(argv.join(' ').includes('--volume app-data:/var/lib/app'));
    assert.ok(argv.join(' ').includes('--volume /srv/conf:/etc/app:ro'));
});

test('the spec label follows every part of the container definition', function () {
    function hash_of(json) {
        const config = config_from_json({remotes: REMOTES, services: [Object.assign({name: 'a', type: 'docker', remote: 'vps1', publish: {host: 'a.test', port: 80}, image: 'x'}, json)]}, '/srv');
        return docker_spec_hash(config.services[0]);
    }
    const plain = hash_of({});
    assert.strictEqual(hash_of({}), plain);
    assert.notStrictEqual(hash_of({image: 'y'}), plain);
    assert.notStrictEqual(hash_of({publish: {host: 'a.test', port: 81}}), plain);
    assert.notStrictEqual(hash_of({env: {A: '1'}}), plain);
    assert.notStrictEqual(hash_of({volumes: ['a:/a']}), plain);
    assert.notStrictEqual(hash_of({network: 'backend'}), plain);
    assert.notStrictEqual(hash_of({args: ['--x']}), plain);
    assert.strictEqual(hash_of({policy: {stop_after_idle: '5m'}}), plain);
});

test('the log folder comes from the environment, data/logs next to the config by default', function () {
    assert.strictEqual(file_log_from_env({}, '/srv').dir, '/srv/data/logs');
    assert.strictEqual(file_log_from_env({SERVICEMAN_LOG_DIR: 'here'}, '/srv').dir, '/srv/here');
    assert.strictEqual(file_log_from_env({SERVICEMAN_LOG_DIR: '/var/log/serviceman'}, '/srv').dir, '/var/log/serviceman');
    assert.strictEqual(file_log_from_env({SERVICEMAN_LOG_DIR: 'none'}, '/srv'), null);
});
