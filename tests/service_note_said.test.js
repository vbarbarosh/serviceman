const assert = require('assert');
const path = require('path');
const test = require('node:test');

const NOW = new Date(2026, 10, 19, 14, 20, 0).getTime();
const MACHINE = {name: 'vps1', phase: 'online', left_at: null};

async function said(view, machine)
{
    const service_note_said = (await import(path.join(__dirname, '..', 'src', 'main', 'public', 'service_note_said.js'))).default;
    return service_note_said(view, (machine === undefined) ? MACHINE : machine, NOW);
}

// A program as the status has it, with what each case changes
function program(fields, first)
{
    const copy = Object.assign({ran_ms: null, exit: null, restarts: 0, restarts_since: null, next_try_ms: null, starting_ms: null}, first);
    return Object.assign({type: 'shell', phase: 'running', doing: null, copy: null, progress: null, progress_text: null, said: [], held: false, stopped_at: null, failures: 0, gave_up: false, error: null, publish: {port: null}, policy: {start: 'always'}, instances: [copy]}, fields);
}

test('a program running as it should has no note', async function () {
    assert.strictEqual(await said(program({})), null);
    assert.strictEqual(await said(program({type: 'files'})), null);
});

test('starting: on which machine, how long so far, when it is up, and its lines', async function () {
    const note = await said(program({phase: 'starting', doing: 'waiting for an answer on 127.0.0.1:8080 — connect ECONNREFUSED', publish: {port: 8080}, said: ['a', 'b', 'c', 'load_tensors: done']}, {starting_ms: 12000}));
    assert.strictEqual(note.tone, 'acc');
    assert.strictEqual(note.title, 'Starting on vps1 · 12s so far');
    assert.strictEqual(note.text, 'It is up once it answers on port 8080.');
    assert.deepStrictEqual(note.lines, ['b', 'c', 'load_tensors: done']);
    assert.strictEqual(note.action, 'logs');
});

test('stopped by you: when, how long it ran, and that nothing but Start starts it', async function () {
    const note = await said(program({phase: 'stopped', held: true, stopped_at: new Date(2026, 10, 19, 14, 18).getTime()}, {ran_ms: 3840000}));
    assert.strictEqual(note.tone, 'idle');
    assert.strictEqual(note.title, 'Stopped by you at 14:18');
    assert.strictEqual(note.text, 'It ran 1h 4m. It stays stopped until you start it; a Save or its machine coming back does not start it.');
});

test('failed: how it ended and when, the starts in a row, that serviceman stopped trying', async function () {
    const note = await said(program({phase: 'failed', failures: 3, gave_up: true, said: ['main: error: unable to load model']}, {exit: 'code 1', stopped_at: new Date(2026, 10, 18, 14, 12).getTime()}));
    assert.strictEqual(note.tone, 'bad');
    assert.strictEqual(note.title, 'It ended with code 1 at 18 Nov 14:12, 3 starts in a row; serviceman stopped trying');
    assert.strictEqual(note.text, 'Its last lines:');
    assert.deepStrictEqual(note.lines, ['main: error: unable to load model']);
    const quiet = await said(program({name: 'llm', phase: 'failed', failures: 2, gave_up: true, error: 'llm: its program ended (code 1) before anything answered — serviceman stopped trying after 2 starts in a row that failed'}, {exit: 'code 1'}));
    assert.strictEqual(quiet.text, 'Its program ended (code 1) before anything answered', 'with no lines of its own, the reason, its name taken off');
});

test('stopping badly over and over: how many times since when, the next try, how it ended', async function () {
    const note = await said(program({phase: 'failed'}, {restarts: 3, restarts_since: new Date(2026, 10, 19, 14, 2).getTime(), next_try_ms: 20000, ran_ms: 40000, exit: 'code 137'}));
    assert.strictEqual(note.tone, 'busy');
    assert.strictEqual(note.title, 'It stopped badly 3 times since 14:02; the next try in 20s');
    assert.strictEqual(note.text, 'The last time it ended with code 137 after 40s. Stop ends it now.');
});

test('its machine away: since when, and the way to the machine', async function () {
    const note = await said(program({phase: 'lost'}), {name: 'vps1', phase: 'offline', left_at: new Date(2026, 10, 19, 13, 2).getTime()});
    assert.strictEqual(note.title, 'vps1 is offline since 13:02');
    assert.strictEqual(note.text, 'serviceman takes it up there as soon as the machine dials in again. Nothing is lost: its settings wait here.');
    assert.strictEqual(note.action, 'machine');
});
