const agent_bundle = require('../src/agent/bundler/agent_bundle');
const agent_version = require('../src/agent/version.json');
const assert = require('assert');
const test = require('node:test');

// Every change to the agent raises its version: version.json keeps the fingerprint of the
// sources the version was given for, and a change that was not given one shows here
test('the agent was given a new version for its last change', function () {
    assert.strictEqual(agent_bundle.sources_hash(), agent_version.sources, `the agent changed since ${agent_version.version}: run bin/agent-version patch (a fix) or minor (something new); major is the author's`);
    assert.match(agent_version.version, /^\d+\.\d+\.\d+$/);
});
