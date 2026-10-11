const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

test('the skins on disk are listed, and their files are served from the skins folder alone', async function () {
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        services: [],
    }, __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    const control_port = servers.control.address().port;
    try {
        const listed = await fetch_host({port: control_port, host: '127.0.0.1', path: '/api/v1/skins'});
        assert.strictEqual(listed.status, 200);
        const skins = JSON.parse(listed.body).skins;
        assert.deepStrictEqual(skins.map(v => v.name), ['ledger']);
        for (const skin of skins) {
            assert.strictEqual(skin.layout, 'rail', `${skin.name} names the one layout the page implements`);
            assert.strictEqual((typeof skin.title === 'string') && (skin.title !== ''), true);
            assert.strictEqual(skin.cover, true, `${skin.name} ships its covers for the picker`);
            const css = await fetch_host({port: control_port, host: '127.0.0.1', path: `/skins/${skin.name}/skin.css`});
            assert.strictEqual(css.status, 200);
            assert.match(css.headers['content-type'], /text\/css/);
            for (const cover_theme of ['light', 'dark']) {
                const cover = await fetch_host({port: control_port, host: '127.0.0.1', path: `/skins/${skin.name}/cover-${cover_theme}.svg`});
                assert.strictEqual(cover.status, 200);
                assert.match(cover.headers['content-type'], /image\/svg/);
            }
        }

        // A skin that is not there is a missing file, not the control page
        const missing = await fetch_host({port: control_port, host: '127.0.0.1', path: '/skins/nothing/skin.css'});
        assert.strictEqual(missing.status, 404);

        // A path that climbs out of the skins folder finds nothing there either
        const outside = await fetch_host({port: control_port, host: '127.0.0.1', path: '/skins/../serviceman.json'});
        assert.strictEqual(outside.status, 404);
    }
    finally {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
    }
});
