const agent_uptime_count = require('../src/agent/src/agent_uptime_count');
const agent_uptime_of = require('../src/agent/src/agent_uptime_of');
const agent_uptime_state = require('../src/agent/src/agent_uptime_state');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// The count is read from these folders, never from beside the agent's own file in src/: the
// agent asks for them when it counts, so setting them here is in time
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-uptime-'));
process.env.SERVICEMAN_AGENT_DIR = ROOT;
process.env.SERVICEMAN_LOG_DIR = path.join(ROOT, 'logs');
process.env.TZ = 'Europe/Chisinau';
const DIR = path.join(ROOT, 'logs', 'servermon');
const BOOT = 1760000000;
const DAY_MS = 24*60*60*1000;
// Midnight of 2026-10-18 in Chisinau, UTC+3 in summer
const DAY_1 = Date.parse('2026-10-18T00:00:00+03:00');
const DAY_2 = DAY_1 + DAY_MS;

test('a second with a line is up: a gap is down, a reboot told from a servermon that stopped, each byte read once', async function () {
    fs.mkdirSync(DIR, {recursive: true});
    // Day 1 from 06:00: an hour from before servermon said its boot, 30 min of nothing, an
    // hour, 30 min of nothing on the same boot, a minute
    const day_1 = [].concat(
        lines_of(DAY_1 + 6*3600e3, 3600, null),
        lines_of(DAY_1 + 7.5*3600e3, 3600, BOOT),
        lines_of(DAY_1 + 9*3600e3, 60, BOOT),
    );
    fs.writeFileSync(path.join(DIR, '20261018.jsonl'), day_1.join(''));
    // Day 2: off from 23:00 the day before to 02:00, booted again; the last line is cut,
    // the way servermon leaves one it is writing
    const day_2 = lines_of(DAY_2 + 2*3600e3, 600, BOOT + 3*3600*24);
    fs.writeFileSync(path.join(DIR, '20261019.jsonl'), `${day_2.join('')}{"time":"2026-10-19T02:10`);
    await agent_uptime_count(null);

    assert.strictEqual(agent_uptime_state.first_at, DAY_1 + 6*3600e3);
    assert.deepStrictEqual(agent_uptime_state.down.map(v => v.why), [null, 'stopped', 'reboot']);
    assert.strictEqual(agent_uptime_state.down[0].to - agent_uptime_state.down[0].from, 30*60e3);

    const until = DAY_2 + 2*3600e3 + 600e3;
    const days = agent_uptime_of(3, until).days;
    assert.deepStrictEqual(days.map(v => v.day), ['2026-10-17', '2026-10-18', '2026-10-19']);
    assert.strictEqual(days[0].known_ms, 0, 'the day before servermon is not known');
    // Day 1 is known from servermon's first line to midnight, and down twice for 30 minutes
    // and from 09:01 on
    assert.strictEqual(days[1].known_ms, 18*3600e3);
    assert.strictEqual(days[1].down.length, 3);
    assert.strictEqual(days[1].down_ms, 2*30*60e3 + (15*3600e3 - 60e3));
    assert.strictEqual(days[2].down[0].from, DAY_2, 'a stretch over midnight is cut at it');
    assert.strictEqual(days[2].down[0].to, DAY_2 + 2*3600e3);
    assert.strictEqual(days[2].known_ms, 2*3600e3 + 600e3);

    // The cut line is finished, and a reboot follows it: only the new bytes are read
    const offset = agent_uptime_state.offset;
    const more = lines_of(DAY_2 + 3*3600e3, 10, BOOT + 4*3600*24);
    fs.appendFileSync(path.join(DIR, '20261019.jsonl'), `:00+03:00","boot":${BOOT + 3*3600*24}}\n${more.join('')}`);
    await agent_uptime_count(null);
    assert.ok(agent_uptime_state.offset > offset);
    assert.deepStrictEqual(agent_uptime_state.down.map(v => v.why), [null, 'stopped', 'reboot', 'reboot'], 'nothing was counted twice');

    // Kept for the next agent, and a stretch still open when asked is down as silent
    const kept = JSON.parse(fs.readFileSync(path.join(ROOT, 'metrics', 'uptime.json'), 'utf8'));
    assert.strictEqual(kept.down.length, 4);
    const later = agent_uptime_of(1, DAY_2 + 4*3600e3).days[0];
    assert.strictEqual(later.down[later.down.length - 1].why, 'silent');
});

// servermon's lines, one a second from `from`: the time first, then the boot when it says one
function lines_of(from, count, boot)
{
    const out = [];
    for (let i = 0; i < count; i++) {
        const time = new Date(from + i*1000 + 3*3600e3).toISOString().slice(0, 19);
        const boot_part = (boot === null) ? '' : `,"boot":${boot}`;
        out.push(`{"time":"${time}+03:00"${boot_part},"cpu":3,"mounts":[{"path":"/home/user/Документы"}]}\n`);
    }
    return out;
}
