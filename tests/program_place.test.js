const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');

async function program_place_of()
{
    return (await import(path.join(PUBLIC, 'program_place.js'))).default;
}

function view_of(folder, remotes, instances)
{
    return {name: 'ai-lab', type: 'shell', folder, remotes, instances: (instances === undefined) ? [] : instances};
}

function remote_of(name, services)
{
    return {name, phase: 'online', machine: (services === undefined) ? null : {services}};
}

test('a program\'s files and shell open in its folder, on the machine that runs it', async function () {
    const program_place = await program_place_of();
    const remotes = [remote_of('vps1', '/home/user/serviceman-agent/services'), remote_of('vps2', '/opt/serviceman-agent/services/')];

    // A folder the config names whole is that folder, on the first machine named
    const named = program_place(view_of('/home/user/apps/ai-lab', ['vps1', 'vps2']), remotes);
    assert.strictEqual(named.remote.name, 'vps1');
    assert.strictEqual(named.folder, '/home/user/apps/ai-lab');

    // The machine running it wins over the first one named
    const running = program_place(view_of('/home/user/apps/ai-lab', ['vps1', 'vps2'], [{phase: 'running', remote: 'vps2'}]), remotes);
    assert.strictEqual(running.remote.name, 'vps2');

    // A folder of serviceman's own is under the agent's services folder, as the agent reads it;
    // none at all is that folder itself
    assert.strictEqual(program_place(view_of('ai-lab.07c20748', ['vps2']), remotes).folder, '/opt/serviceman-agent/services/ai-lab.07c20748');
    assert.strictEqual(program_place(view_of('./ai-lab/', ['vps1']), remotes).folder, '/home/user/serviceman-agent/services/ai-lab');
    assert.strictEqual(program_place(view_of(null, ['vps1']), remotes).folder, '/home/user/serviceman-agent/services');
    assert.strictEqual(program_place(view_of('.', ['vps1']), remotes).folder, '/home/user/serviceman-agent/services');
});

test('a program whose machine or folder cannot be told yet says why, and opens nothing', async function () {
    const program_place = await program_place_of();
    const remotes = [remote_of('vps1'), remote_of('vps2', '/srv/services')];

    // Only a tag: the machine is picked when it starts
    const tagged = program_place(view_of('/srv/app', ['#eu']), remotes);
    assert.strictEqual(tagged.remote, null);
    assert.match(tagged.why, /#eu, picked when it starts/);

    // A tag, but running: its machine is known
    assert.strictEqual(program_place(view_of('/srv/app', ['#eu'], [{phase: 'running', remote: 'vps2'}]), remotes).remote.name, 'vps2');

    // A machine that has not said where its programs live: a whole folder is still known, a
    // folder under it is not
    assert.strictEqual(program_place(view_of('/srv/app', ['vps1']), remotes).folder, '/srv/app');
    assert.strictEqual(program_place(view_of('app.1234', ['vps1']), remotes).remote, null);

    // A machine the remotes do not have
    assert.match(program_place(view_of('/srv/app', ['laptop']), remotes).why, /laptop is not one of serviceman's machines/);
});
