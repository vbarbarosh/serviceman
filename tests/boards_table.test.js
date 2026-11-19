const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');

// Boards is a table, as drawn: a board's row says its apps, or why it is not answered, and its state
test('Boards: a row per board, published, a draft, or on a machine away', async function () {
    const pane = (await import(path.join(PUBLIC, 'boards_pane.js'))).default;
    const state = {services: [{name: 'site', title: ''}, {name: 'grafana', title: ''}, {name: 'shop', title: 'Shop'}, {name: 'notes', title: ''}], remotes: [{name: 'vps1', phase: 'online', left_at: null}, {name: 'desktop', phase: 'offline', left_at: null}]};
    const self = Object.assign({state}, pane.methods);
    self.apps = pane.computed.apps.call(self);
    const home = board_row(pane, self, {name: 'home', machines: ['vps1'], apps: ['site', 'grafana', 'shop', 'notes']});
    assert.deepStrictEqual([home.line, home.kind, home.pill.text, home.apps_said], ['site, grafana, Shop and 1 more', 'published', 'published', '4 apps']);
    const draft = board_row(pane, self, {name: 'new', machines: [], apps: ['site']});
    assert.deepStrictEqual([draft.line, draft.kind, draft.pill.text, draft.apps_said], ['not published yet', 'draft', 'draft', '1 app']);
    const away = board_row(pane, self, {name: 'family', machines: ['desktop'], apps: []});
    assert.deepStrictEqual([away.line, away.tone, away.kind, away.pill.text], ['desktop not linked', 'bad', 'needs', 'machine offline']);
});

// A board's row as the Boards page makes it
function board_row(pane, self, board)
{
    return pane.methods.row_of.call(self, Object.assign({port: 3000}, board));
}
