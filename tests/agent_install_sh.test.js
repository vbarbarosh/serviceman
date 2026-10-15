const agent_install_sh = require('../src/main/src/helpers/agent_install_sh');
const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// A shell opened with su or sudo has no XDG_RUNTIME_DIR: systemctl --user finds no bus there,
// even while the person's own systemd runs at /run/user/<uid>
test('bin/install from a shell with no XDG_RUNTIME_DIR finds the systemd at /run/user/<uid>', function () {
    const run = make_machine({bus_at: `/run/user/${process.getuid()}`});
    const said = run('sh', [run.installer, '--token', 't', '--prefix', run.prefix]);
    assert.match(said, /the agent is up — systemctl --user status serviceman-agent/);
    assert.ok(fs.existsSync(run.unit_file));
    assert.match(run.calls(), /systemctl --user enable --now serviceman-agent XDG=\/run\/user\/\d+/);

    assert.match(run('sh', [path.join(run.prefix, 'bin', 'restart')]), /the agent is up/);
    assert.match(run('sh', [path.join(run.prefix, 'bin', 'uninstall')]), /stopped and out of your systemd/);
    assert.ok(!fs.existsSync(run.unit_file));
});

test('bin/install with no systemd of its own says what to do, and leaves no unit behind', function () {
    const run = make_machine({bus_at: '/nowhere'});
    const said = run('sh', [run.installer, '--token', 't', '--prefix', run.prefix]);
    assert.match(said, /your own systemd does not answer in this shell/);
    assert.match(said, /run once as root: loginctl enable-linger \S+/);
    assert.match(said, /nothing was installed to keep it up/);
    assert.match(run.calls(), /loginctl enable-linger/, 'lingering is tried first');
    assert.ok(!fs.existsSync(run.unit_file), 'a unit left behind sends bin/restart into the same wall');
});

test('bin/restart with no bus says so, and points at bin/install', function () {
    const run = make_machine({bus_at: `/run/user/${process.getuid()}`});
    run('sh', [run.installer, '--token', 't', '--prefix', run.prefix]);
    const restart = path.join(run.prefix, 'bin', 'restart');
    const failed = child_process.spawnSync('sh', [restart], {env: {...run.env, BUS_AT: '/nowhere'}, encoding: 'utf8'});
    assert.strictEqual(failed.status, 1);
    assert.match(failed.stderr, /your own systemd does not answer in this shell — bin\/install says why/);
});

test('bin/install keeps the XDG_RUNTIME_DIR a login gave it', function () {
    const run = make_machine({bus_at: '/run/custom', xdg: '/run/custom'});
    assert.match(run('sh', [run.installer, '--token', 't', '--prefix', run.prefix]), /the agent is up/);
    assert.doesNotMatch(run.calls(), /XDG=\/run\/user\//);
});

// A machine of fakes: curl writes what it is asked to fetch, systemctl answers --user only where
// BUS_AT says the bus is, loginctl agrees to everything and changes nothing
function make_machine({bus_at, xdg})
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-install-'));
    const bin = path.join(dir, 'bin');
    const home = path.join(dir, 'home');
    const log = path.join(dir, 'calls.log');
    fs.mkdirSync(bin);
    fs.mkdirSync(home);
    fake(bin, 'curl', 'while [ $# -gt 0 ]; do [ "$1" = -o ] && echo "//" > "$2"; shift; done');
    fake(bin, 'systemctl', 'echo "systemctl $* XDG=${XDG_RUNTIME_DIR:-}" >> "$LOG"\n[ "${XDG_RUNTIME_DIR:-}" = "$BUS_AT" ] || { echo "Failed to connect to bus" >&2; exit 1; }');
    fake(bin, 'loginctl', 'echo "loginctl $*" >> "$LOG"\n[ "$1" = show-user ] && echo Linger=yes\nexit 0');
    fake(bin, 'sleep', 'exit 0');

    const installer = path.join(dir, 'install.sh');
    fs.writeFileSync(installer, agent_install_sh('http://127.0.0.1:9'));

    const env = {HOME: home, PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'), LOG: log, BUS_AT: bus_at};
    if (xdg) {
        env.XDG_RUNTIME_DIR = xdg;
    }

    function run(cmd, args) {
        return child_process.execFileSync(cmd, args, {env, encoding: 'utf8'});
    }
    run.env = env;
    run.installer = installer;
    run.prefix = path.join(dir, 'agent');
    run.unit_file = path.join(home, '.config', 'systemd', 'user', 'serviceman-agent.service');
    run.calls = function () {
        return fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    };
    return run;
}

function fake(bin, name, body)
{
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, {mode: 0o755});
}
