const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
const DAY_MS = 86400000;
// Nov 15, 2026, 00:00 UTC
const NOV_15 = Date.UTC(2026, 10, 15);

// A machine's uptime in its head, by its own computed parts: what it says over its dots while it
// is read, for an agent too old, for an answer refused, for days servermon never counted, for days
// all up and for days with a stretch down; and the day it went, red while it is away, the share
// as its agent counted it
test('the uptime in a machine\'s head says its days, its share and how long it was down', async function () {
    const remote_uptime = (await import(path.join(PUBLIC, 'remote_uptime.js'))).default;

    assert.deepStrictEqual(words_of(remote_uptime, {loading: true}), ['Uptime', '—', 'reading…']);
    const old = words_of(remote_uptime, {old: true, error: 'the agent on vps1 is from before uptime'});
    assert.deepStrictEqual(old, ['Uptime', '—', 'agent too old']);
    assert.strictEqual(self_of(remote_uptime, {old: true}).title, 'Uptime needs agent 1.22 or newer; this machine runs 1.20.0: Configure updates it');
    assert.deepStrictEqual(words_of(remote_uptime, {error: 'vps1 is not connected, and its uptime is counted on it'}), ['Uptime', '—', 'not read']);
    assert.deepStrictEqual(words_of(remote_uptime, {data: answer_of([0, 0, 0], [0, 0, 0])}), ['Uptime', '—', 'nothing counted yet']);
    assert.deepStrictEqual(words_of(remote_uptime, {data: answer_of([0, DAY_MS], [0, 0])}), ['Uptime, 1 day', '100%', '']);
    // 252 s down of two days: 99.8%, never rounded up to 100%
    assert.deepStrictEqual(words_of(remote_uptime, {data: answer_of([0, DAY_MS, DAY_MS], [0, 0, 252000])}), ['Uptime, 2 days', '99.8%', 'down 4m 12s']);

    const away = self_of(remote_uptime, {data: Object.assign(answer_of([DAY_MS, 3600000], [0, 0]), {away: true, until: NOV_15 + DAY_MS + 3600000})});
    assert.deepStrictEqual(away.days.map(v => v.kind), ['up', 'bad']);
    assert.strictEqual(away.days[1].said, 'away: nothing heard from its agent since 01:00');
    assert.deepStrictEqual([away.label, away.value, away.small], ['Uptime, 2 days', '100%', '']);
});

// The agent's answer for days from Nov 15: each day's time known and down, a stretch for the down
function answer_of(known, down)
{
    const days = known.map(function (v, i) {
        const at = NOV_15 + i*DAY_MS;
        const stretches = (down[i] === 0) ? [] : [{since: at + 3600000, until: at + 3600000 + down[i], why: 'reboot'}];
        return {day: new Date(at).toISOString().slice(0, 10), known_ms: v, down_ms: down[i], down: stretches, down_more: 0};
    });
    return {tz: 'UTC', days, away: false};
}

// The component's state as `state` sets it, its computed parts read as Vue reads them
function self_of(component, state)
{
    const self = Object.assign(component.data(), {view: {name: 'vps1', agent_version: '1.20.0', phase: 'online'}}, state);
    for (const [key, computed] of Object.entries(component.computed)) {
        Object.defineProperty(self, key, {get: () => computed.call(self)});
    }
    return self;
}

// Its label, its value and the small words beside the value
function words_of(component, state)
{
    const self = self_of(component, state);
    return [self.label, self.value, self.small];
}
