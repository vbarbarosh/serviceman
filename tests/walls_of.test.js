const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');

async function walls_of_of()
{
    return (await import(path.join(PUBLIC, 'walls_of.js'))).default;
}

// The walls every list offers: authwall, one made for a team, and any service something stands
// behind, authwall first; with each its team and what stands behind it
test('the walls: authwall first, a team\'s by its name, any other by what stands behind it', async function () {
    const walls_of = await walls_of_of();
    const state = {
        apps: {auth: 'authwall-team-a'},
        services: [
            {name: 'gate', title: 'gate', auth: null},
            {name: 'notes', title: 'notes', auth: 'authwall-team-a'},
            {name: 'board', title: 'board', auth: 'authwall'},
            {name: 'authwall-team-a', title: 'team A', auth: null},
            {name: 'authwall', title: 'family', auth: null},
            {name: 'crm', title: 'crm', auth: null},
        ],
        remotes: [{name: 'vps1', inbound: {'sam.example.com': {service: 'crm', auth: 'gate'}, 'board.example.com': {service: 'board', auth: 'authwall'}, 'open.example.com': 'crm'}}],
    };
    assert.deepStrictEqual(walls_of(state), [
        {name: 'authwall', team: 'family', apps: 1, names: 0, service: true},
        {name: 'authwall-team-a', team: 'team A', apps: 1, names: 0, service: true},
        {name: 'gate', team: '', apps: 0, names: 1, service: true},
    ], 'a name of a service walled at every address is counted with that service');
    assert.deepStrictEqual(walls_of({services: [{name: 'crm', title: 'crm', auth: 'lost'}], remotes: []}), [{name: 'lost', team: '', apps: 1, names: 0, service: false}], 'a wall nobody is called is listed, and says so');
    assert.deepStrictEqual(walls_of({services: [{name: 'notes', title: 'notes', auth: null}], remotes: [], apps: null}), [], 'no wall at all');
});
