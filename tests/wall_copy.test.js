const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const test = require('node:test');
const wall_copy = require('../src/main/src/helpers/wall_copy');

// authwall as the tutorial sets it up, with what a wall in use has beside: its address in its
// settings, who may sign in, a mailer, a secret of its own, a read-only file of settings
const WALL = {
    name: 'authwall',
    title: 'family',
    type: 'docker',
    image: 'vbarbarosh/authwall:latest',
    remotes: ['laptop'],
    publish: {host: 'authwall.localhost', port: 3000},
    env: {
        AUTHWALL_SEED: 'demo:demo-pass-1234:user@example.com',
        AUTHWALL_SECRET: 'x'.repeat(40),
        AUTHWALL_DB: 'sqlite:///app/data/users.sqlite3',
        AUTHWALL_PUBLIC_URL: 'http://authwall.localhost:3000',
        AUTHWALL_GOOGLE_REDIRECT_URL: 'http://authwall.localhost:3000/auth/google/callback',
        AUTHWALL_ALLOWED_DOMAINS: 'example.com',
        AUTHWALL_MAILER: 'resend',
        AUTHWALL_COOKIE_DOMAIN: 'sso.authwall.localhost',
    },
    volumes: [{source: '', target: '/app/data'}, 'authwall-logs:/app/logs', './settings.yaml:/app/config/settings.yaml:ro'],
    policy: {start: 'always'},
};

const USER = {username: 'ann', password: 'a-long-password', email: 'ann@example.com'};

test('a wall for another team runs as the wall does: the same image, port, machines and settings', function () {
    const copy = wall_copy(WALL, {name: 'authwall-team-a', title: 'team A', user: USER}, 'localhost');
    assert.strictEqual(copy.name, 'authwall-team-a');
    assert.strictEqual(copy.title, 'team A');
    assert.strictEqual(copy.image, WALL.image);
    assert.strictEqual(copy.publish.port, 3000);
    assert.deepStrictEqual(copy.remotes, ['laptop']);
    assert.deepStrictEqual(copy.policy, {start: 'always'});
    assert.strictEqual(copy.env.AUTHWALL_ALLOWED_DOMAINS, 'example.com', 'who may sign in goes over, to be changed on its page');
    assert.strictEqual(copy.env.AUTHWALL_MAILER, 'resend');
});

test('and is a wall of its own: its address, its storage, no secret, database or users of the first', function () {
    const copy = wall_copy(WALL, {name: 'authwall-team-a', title: 'team A', user: USER}, 'localhost');
    assert.deepStrictEqual(copy.publish, {host: 'authwall-team-a.localhost', port: 3000});
    assert.strictEqual(copy.env.AUTHWALL_PUBLIC_URL, 'http://authwall-team-a.localhost:3000');
    assert.strictEqual(copy.env.AUTHWALL_GOOGLE_REDIRECT_URL, 'http://authwall-team-a.localhost:3000/auth/google/callback');
    assert.strictEqual(copy.env.AUTHWALL_COOKIE_DOMAIN, 'sso.authwall.localhost', 'a longer name is another name, and stays');
    assert.strictEqual(copy.env.AUTHWALL_SECRET, undefined);
    assert.strictEqual(copy.env.AUTHWALL_DB, undefined);
    assert.deepStrictEqual(JSON.parse(copy.env.AUTHWALL_SEED), [{username: 'ann', emails: 'ann@example.com', password: 'a-long-password'}]);
    assert.deepStrictEqual(copy.volumes, [{source: '', target: '/app/data'}, {source: '', target: '/app/logs'}, './settings.yaml:/app/config/settings.yaml:ro']);
    assert.deepStrictEqual(WALL.env.AUTHWALL_SEED, 'demo:demo-pass-1234:user@example.com', 'the first wall is left as it was');
});

test('with no first user given it starts with none, not with the users of the first wall', function () {
    const copy = wall_copy(WALL, {name: 'authwall-team-b', title: '', user: null}, 'localhost');
    assert.strictEqual(copy.env.AUTHWALL_SEED, undefined);
    assert.strictEqual(copy.title, undefined, 'no team given: its name is its title');
});

test('an address given by hand stays with the first wall; the copy gets one made of its name', function () {
    const entry = Object.assign({}, WALL, {publish: {hosts: ['sign-in.example.com', 'authwall.localhost'], port: 3000}});
    assert.deepStrictEqual(wall_copy(entry, {name: 'authwall-team-a', title: '', user: null}, 'localhost').publish, {host: 'authwall-team-a.localhost', port: 3000});
    const by_hand = Object.assign({}, WALL, {publish: {host: 'sign-in.example.com', port: 3000}});
    assert.deepStrictEqual(wall_copy(by_hand, {name: 'authwall-team-a', title: '', user: null}, 'localhost').publish, {host: 'authwall-team-a.localhost', port: 3000});
});

test('a copy is a config serviceman takes beside the first wall', function () {
    const json = {
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'laptop', token: 'cccccccccccccccccccccccccccccccc'}],
        services: [WALL, wall_copy(WALL, {name: 'authwall-team-a', title: 'team A', user: USER}, 'localhost')],
    };
    const config = config_from_json(json, __dirname);
    const [first, copy] = config.services;
    assert.deepStrictEqual(copy.volumes.map(v => v.keep), ['authwall-team-a/app-data', 'authwall-team-a/app-logs', undefined]);
    assert.deepStrictEqual(first.volumes.map(v => v.keep), ['authwall/app-data', undefined, undefined]);
});

test('only a wall serviceman runs as a docker image can be copied', function () {
    const external = {name: 'authwall', type: 'external', publish: {host: 'authwall.localhost'}, upstream: '127.0.0.1:3200'};
    assert.throws(() => wall_copy(external, {name: 'authwall-team-a', title: '', user: null}, 'localhost'), v => (v.status === 400) && /not a docker image serviceman runs/.test(v.message));
});
