const assert = require('assert');
const serviceman_here = require('../src/main/src/helpers/serviceman_here');
const test = require('node:test');

function app_of(own, seen)
{
    return {own_container: own, security: {seen: new Map(Object.entries(seen))}};
}

// The Updates page says which machine goes last, alone, before Install is pressed: the one whose
// last Security look found serviceman's own container running
test('serviceman runs where its last look found its own container', function () {
    const app = app_of('c0ffee', {laptop: {at: 1, facts: {docker: {ids: ['aa', 'c0ffee']}}}, vps1: {at: 1, facts: {docker: {ids: ['aa']}}}});
    assert.strictEqual(serviceman_here(app, {name: 'laptop'}), true);
    assert.strictEqual(serviceman_here(app, {name: 'vps1'}), false);
});

// No look yet, a look that failed, no docker there, or serviceman outside docker: not known, so
// no machine is said to go last
test('without a look, or outside docker, no machine is serviceman\'s', function () {
    const app = app_of('c0ffee', {vps1: {at: 1, error: 'refused'}, vps2: {at: 1, facts: {docker: null}}});
    assert.strictEqual(serviceman_here(app, {name: 'laptop'}), false);
    assert.strictEqual(serviceman_here(app, {name: 'vps1'}), false);
    assert.strictEqual(serviceman_here(app, {name: 'vps2'}), false);
    assert.strictEqual(serviceman_here(app_of(null, {}), {name: 'laptop'}), false);
});
