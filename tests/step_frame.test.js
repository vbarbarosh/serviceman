const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
const GB = 1024*1024*1024;

// Every form that makes something, by its file
const FORMS = ['service_form', 'remote_form', 'database_new', 'secrets_form', 'tokens_form', 'shared_folders_pane', 'mounts_section', 'forwards_section', 'load_tests_pane'];

function source_of(name)
{
    return fs.readFileSync(path.join(PUBLIC, `${name}.js`), 'utf8');
}

async function machine_card_of()
{
    return (await import(path.join(PUBLIC, 'machine_card.js'))).default;
}

// The kit frames every form the same way: a card, its steps in a band, one question with a line
// under it; a form drawn bare would fall out of the kit
test('every create form stands in the step frame, a line under each question', function () {
    for (const name of FORMS) {
        const text = source_of(name);
        assert.match(text, /<step-frame /, `${name} stands in the frame`);
        // A step is an object with a name and a question; its line, says, is in the same one
        const steps = text.split('\n').filter(v => /name: [^,]+, question: /.test(v));
        assert.ok(steps.length > 0, `${name} asks its questions`);
        for (const line of steps) {
            assert.match(line, /\bsays\b/, `${name}: ${line.trim().slice(0, 60)} has its line`);
        }
    }
});

test('the frame draws its band of steps, Step n of m on a phone, and its foot bar', function () {
    const text = source_of('step_frame');
    for (const part of ['sf-head', 'sf-band', 'sf-phone-steps', 'sf-body', 'sf-says', 'sf-foot', 'sf-summary']) {
        assert.ok(text.includes(`class="${part}"`) || text.includes(`class="${part} `), `the frame has ${part}`);
    }
});

// A machine is picked from its tile wherever a form asks for one, never from a list
test('a form that asks for a machine draws the machines as tiles', function () {
    for (const name of ['service_form', 'database_new', 'shared_folders_pane', 'load_tests_pane']) {
        assert.match(source_of(name), /<machine-tile /, `${name} draws machine tiles`);
    }
});

test('a machine online says what it is, its services and its free memory, with a meter', async function () {
    const machine_card = await machine_card_of();
    const card = machine_card({name: 'laptop', title: 'this computer', phase: 'online', left_at: null, machine: {mem: {free: 6*GB, total: 16*GB}}}, 'laptop', 4);
    assert.deepStrictEqual(card.lines, ['this computer · 4 services', '6.0 GB of 16 GB free']);
    assert.strictEqual(card.dot, 'on');
    assert.strictEqual(card.away, false);
    assert.strictEqual(card.meter.low, false);
    assert.ok(Math.abs(card.meter.used - 0.625) < 0.001);
});

test('a machine short of memory has its meter orange', async function () {
    const machine_card = await machine_card_of();
    const card = machine_card({name: 'server', title: 'at home', phase: 'online', left_at: null, machine: {mem: {free: 0.4*GB, total: 4*GB}}}, undefined, 1);
    assert.deepStrictEqual(card.lines, ['at home · 1 service', '410 MB of 4.0 GB free']);
    assert.strictEqual(card.meter.low, true);
});

test('a machine offline says since when, and has no meter', async function () {
    const machine_card = await machine_card_of();
    const clock_of = (await import(path.join(PUBLIC, 'clock_of.js'))).default;
    const left_at = Date.UTC(2026, 10, 19, 8, 12);
    const card = machine_card({name: 'desktop', title: '', phase: 'offline', left_at, machine: null}, 'server', 2);
    assert.deepStrictEqual(card.lines, ['2 services', `offline since ${clock_of(left_at)}`]);
    assert.strictEqual(card.dot, 'off');
    assert.strictEqual(card.away, true);
    assert.strictEqual(card.meter, null);
});

test('a machine that keeps files says its free disk where it says its services', async function () {
    const machine_card = await machine_card_of();
    const card = machine_card({name: 'vps1', title: 'rented', phase: 'online', left_at: null, machine: {mem: {free: 3*GB, total: 8*GB}, disk: {free: 120*GB, total: 160*GB}}}, 'server', 6, true);
    assert.deepStrictEqual(card.lines, ['rented · 120 GB disk free', '3.0 GB of 8.0 GB free']);
});

test('a machine that never connected says so, its title the same as its name left out', async function () {
    const machine_card = await machine_card_of();
    const card = machine_card({name: 'vps2', title: 'vps2', phase: 'offline', left_at: null, machine: null}, undefined, 0);
    assert.deepStrictEqual(card.lines, ['0 services', 'not connected yet']);
});
