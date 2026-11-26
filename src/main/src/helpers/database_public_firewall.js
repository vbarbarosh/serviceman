const log_event = require('./log_event');
const remote_call = require('./remote_call');
const remote_can = require('./remote_can');

// How long ufw has to answer, as the Firewall tab gives it
const UFW_TIMEOUT_MS = 40000;

// The machine's firewall made to let a database server's public port in, through its agent's
// ufw, as root: the rules serviceman wrote for it before taken out, and one for each address it
// lets in (one from anywhere when it lets everyone in) added, each with the comment
// `serviceman:<server>:public` they are found by again. No public port left: its rules go. With
// ufw off, nothing is written: the port is open to whoever reaches the machine, as every port
// there is. Answers what the page says beside the port, kept in app.database_firewall.
//
//     server    {name, remote} as databases_read keeps it
async function database_public_firewall(app, server)
{
    const remote = app.remote_by_name[server.remote];
    const forward = app.config.forwards.find(v => (v.database === server.name) && (v.to.host === '0.0.0.0') && (v.off === false));
    let said;
    try {
        said = await rules_write(app, remote, server, forward);
    }
    catch (error) {
        said = `its firewall was not told: ${error.message}; let port ${(forward === undefined) ? 'it' : forward.to.port} in on its Firewall tab`;
        log_event(app, 'database_firewall_error', {database: server.name, remote: server.remote, reason: error.message});
    }
    app.database_firewall.set(server.name, said);
    return said;
}

async function rules_write(app, remote, server, forward)
{
    if ((remote === undefined) || (remote.state.phase !== 'online')) {
        throw new Error(`${server.remote} is not online`);
    }
    if (remote_can(remote, 'ufw') === false) {
        throw new Error(`the agent on ${server.remote} is from before the firewall`);
    }
    const comment = `serviceman:${server.name}:public`;
    const status = await ufw(app, remote, ['status']);
    const active = /^Status: active/m.test(status.stdout);
    const added = await ufw(app, remote, ['show', 'added']);
    const ours = added.stdout.split('\n').filter(v => v.startsWith('ufw ') && v.includes(`comment '${comment}'`));
    for (const line of ours) {
        await ufw(app, remote, ['delete'].concat(words_of(line)));
    }
    const wanted = (forward === undefined) ? [] : ((forward.allow.length === 0) ? ['any'] : forward.allow);
    for (const from of wanted) {
        await ufw(app, remote, ['allow', 'proto', 'tcp', 'from', from, 'to', 'any', 'port', String(forward.to.port), 'comment', comment]);
    }
    log_event(app, 'database_firewall', {database: server.name, remote: server.remote, removed: ours.length, added: wanted.join(', ') || 'none', active});
    if (forward === undefined) {
        return '';
    }
    if (active === false) {
        return `its firewall, ufw, is off: port ${forward.to.port} is open to whoever reaches ${server.remote}`;
    }
    return (forward.allow.length === 0) ? `its firewall lets port ${forward.to.port} in from anywhere` : `its firewall lets port ${forward.to.port} in from ${forward.allow.join(', ')} alone`;
}

async function ufw(app, remote, argv)
{
    const said = await remote_call(app, remote, 'ufw', {argv}, UFW_TIMEOUT_MS);
    if (said.ok === false) {
        throw new Error((said.stderr || said.stdout).trim().split('\n').pop() || `ufw ended with ${said.code}`);
    }
    return said;
}

// A rule as `ufw show added` lists it, back to ufw's words: its comment, one word in quotes
function words_of(line)
{
    const quoted = /'([^']*)'$/.exec(line);
    const head = line.replace(/^ufw /, '').replace(/ '[^']*'$/, '');
    return head.split(' ').concat((quoted === null) ? [] : [quoted[1]]);
}

module.exports = database_public_firewall;
