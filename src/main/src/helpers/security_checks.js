const updates_check = require('./updates_check');

// Ports nobody means to leave open to the internet: databases, caches, queues and the like,
// each with what usually listens there. Open, they are to be mended.
const RISKY = {
    1433: 'SQL Server', 2181: 'ZooKeeper', 2375: 'Docker\'s API', 2376: 'Docker\'s API', 2379: 'etcd',
    3306: 'MySQL', 5432: 'PostgreSQL', 5601: 'Kibana', 5672: 'RabbitMQ', 5900: 'VNC', 5984: 'CouchDB',
    6379: 'Redis', 7474: 'Neo4j', 8086: 'InfluxDB', 8500: 'Consul', 9042: 'Cassandra', 9092: 'Kafka',
    9200: 'Elasticsearch', 10250: 'the kubelet', 11211: 'memcached', 15672: 'RabbitMQ\'s page', 27017: 'MongoDB',
};
// Ports a server is open on by design: the web, and the tunnels and VPNs machines reach each
// other by. ssh is the SSH check's to judge.
const MEANT = ['tcp/80', 'tcp/443', 'udp/443', 'udp/41641', 'udp/51820', 'udp/3478'];
// How long before its end a release is said to be ending
const ENDING_MS = 183*24*3600*1000;

// What the Security page says of one machine, a check a column: what is open to the internet,
// the firewall, ssh, updates, automatic updates and the release. Each is ok, warn (look at it),
// bad (mend it) or none (nothing to say, and why), with a line of detail and the tab of the
// machine's page that mends it.
//
//     seen      security_of_remote's answer
//     updates   the machine's updates, as its agent counts them, or null
//     now       ms, for the release's end
//     out       [{key, label, state, text, detail, tab}]
function security_checks(seen, updates, now)
{
    return [
        open_check(seen),
        firewall_check(seen),
        ssh_check(seen),
        updates_of(updates),
        auto_check(seen),
        system_check(seen, now),
    ];
}

// The ports the internet gets to: one that answered the knock from outside, or, where nobody
// knocked, one whose address the internet reaches and that nothing keeps out now
function open_check(seen)
{
    if (seen.errors.ports !== null) {
        return check('open', 'Open to the internet', 'none', 'not read', `Its ports could not be read: ${seen.errors.ports}`, null);
    }
    const open = seen.rows.filter(row_open);
    const risky = open.filter(v => RISKY[v.port] !== undefined);
    const other = open.filter(v => (RISKY[v.port] === undefined) && (MEANT.includes(`${v.proto}/${v.port}`) === false) && (ssh_port(seen, v) === false));
    const lines = open.map(port_line);
    const kept = seen.rows.filter(v => (v.knock === 'silent') || (v.knock === 'refused')).filter(v => (v.reach.exposure === 'open') && (row_open_inside(v)));
    for (const row of kept) {
        lines.push(`${row.port}/${row.proto}: open from inside, yet no answer from outside`);
    }
    lines.push(knocked_line(seen));
    const detail = lines.join('\n');
    const tab = open.some(v => v.docker !== null) ? 'docker' : 'firewall';
    if (risky.length > 0) {
        return check('open', 'Open to the internet', 'bad', ports_text(risky.concat(other)), detail, tab);
    }
    if (other.length > 0) {
        return check('open', 'Open to the internet', 'warn', ports_text(other), detail, tab);
    }
    return check('open', 'Open to the internet', 'ok', (open.length === 0) ? 'nothing' : ports_text(open), detail, (open.length === 0) ? null : 'firewall');
}

// Open from here: it answered the knock; or, unknocked, the internet reaches its address and
// nothing keeps it out now (no ufw, ufw off, a rule or Docker letting it in)
function row_open(row)
{
    if (row.knock === 'answered') {
        return true;
    }
    if ((row.knock === 'silent') || (row.knock === 'refused')) {
        return false;
    }
    return (row.reach.exposure === 'open') && row_open_inside(row);
}

function row_open_inside(row)
{
    return (row.verdict.kind === 'open') || (row.verdict.kind === 'unknown') || ((row.verdict.kind === 'closed') && (row.verdict.now === false));
}

// sshd's own port: the SSH check says whether it is safe
function ssh_port(seen, row)
{
    const ssh = (seen.facts === null) ? null : seen.facts.ssh;
    if ((row.proto !== 'tcp') || (ssh === null) || (ssh === undefined)) {
        return (row.proto === 'tcp') && (row.port === 22);
    }
    return Array.isArray(ssh.ports) && (ssh.ports.length > 0) ? ssh.ports.includes(row.port) : (row.port === 22);
}

function port_line(row)
{
    const what = (RISKY[row.port] === undefined) ? '' : ` (${RISKY[row.port]}'s port)`;
    const held = (row.docker !== null) ? ` published by Docker${(row.docker.name === null) ? '' : ` for ${row.docker.name}`}${(row.docker.image === null) ? '' : ` (${row.docker.image})`}` : ((row.held === '') ? '' : ` held by ${row.held}`);
    const how = (row.knock === 'answered') ? 'answered from outside' : `${row.verdict.text || 'nothing keeps it out'}; not knocked`;
    return `${row.port}/${row.proto}${what}${held}: ${how}`;
}

function knocked_line(seen)
{
    const knocked = seen.knocked;
    if (knocked.skipped !== null) {
        return `Not knocked from outside: ${knocked.skipped}.`;
    }
    const counts = {};
    for (const row of seen.rows) {
        if (row.knock !== null) {
            counts[row.knock] = (counts[row.knock] || 0) + 1;
        }
    }
    const said = Object.keys(counts).map(v => `${counts[v]} ${v}`).join(', ');
    return `Knocked from serviceman at ${knocked.addresses.join(' and ')}${(said === '') ? ': no port to knock' : `: ${said}`}.`;
}

// A few ports by number, the rest counted; Docker's said so
function ports_text(rows)
{
    const shown = rows.slice(0, 3).map(v => `${v.port}${(v.docker !== null) ? ' · Docker' : ''}`);
    return (rows.length > 3) ? `${shown.join(' · ')} +${rows.length - 3}` : shown.join(' · ');
}

function firewall_check(seen)
{
    const firewall = seen.firewall;
    if (seen.errors.firewall !== null) {
        return check('firewall', 'Firewall', 'none', 'cannot ask', seen.errors.firewall, 'firewall');
    }
    if (firewall.installed === false) {
        return check('firewall', 'Firewall', 'none', 'no ufw', 'ufw is not installed: nothing on the machine keeps out what it listens on, unless another firewall does.', 'firewall');
    }
    if (firewall.active === false) {
        return check('firewall', 'Firewall', 'warn', 'off', 'ufw is installed and off: every port the machine listens on is open to whoever reaches it.', 'firewall');
    }
    const count = firewall.rules.length;
    return check('firewall', 'Firewall', 'ok', 'on', `On, ${count} ${(count === 1) ? 'rule' : 'rules'}, incoming ${(firewall.defaults === null) ? 'denied' : (firewall.defaults.incoming || 'denied')} by default.`, 'firewall');
}

// Passwords sshd takes, and root signing in, as sshd itself says them where the root half could
// ask it, else as its files say; the sign-ins that failed in the last day beside them
function ssh_check(seen)
{
    if (seen.facts === null) {
        return check('ssh', 'SSH', 'none', 'not read', seen.errors.facts, null);
    }
    const ssh = seen.facts.ssh;
    if (ssh.installed === false) {
        return check('ssh', 'SSH', 'ok', 'no sshd', 'No ssh server is installed: nobody signs in over ssh.', null);
    }
    const tried = failures_line(seen.facts.failures);
    if (ssh.read === null) {
        return check('ssh', 'SSH', 'none', seen.facts.root ? 'not read' : 'needs root half', [`sshd's settings could not be read: ${ssh.error}`, tried].filter(v => v !== null).join('\n'), null);
    }
    const how = (ssh.read === 'sshd -T') ? 'as sshd -T says them' : 'as its files say them';
    const kbd = (ssh.kbd_interactive === true) && (ssh.use_pam === true);
    if ((ssh.password === true) || kbd) {
        const setting = (ssh.password === true) ? 'PasswordAuthentication yes' : 'KbdInteractiveAuthentication yes with UsePAM yes';
        const fix = 'Once your key signs in, set PasswordAuthentication no and KbdInteractiveAuthentication no in /etc/ssh/sshd_config and in every file of /etc/ssh/sshd_config.d that says yes, then: sudo systemctl reload ssh';
        return check('ssh', 'SSH', 'bad', 'passwords on', [`${setting} (${how}): anyone may try passwords.`, tried, fix].filter(v => v !== null).join('\n'), 'shell');
    }
    const root = (ssh.root_login === 'yes') ? ' Root may sign in, with a key.' : ((ssh.root_login === 'no') ? ' Root may not sign in.' : '');
    return check('ssh', 'SSH', 'ok', 'keys only', [`Keys only (${how}).${root}`, tried].filter(v => v !== null).join('\n'), null);
}

function failures_line(failures)
{
    if ((failures === null) || (failures === undefined)) {
        return null;
    }
    if (failures.error !== undefined) {
        return `Failed sign-in tries not counted: ${failures.error}`;
    }
    if (failures.count === 0) {
        return `No failed sign-in try in the last ${failures.hours} hours.`;
    }
    const top = (failures.top.length === 0) ? '' : `; most from ${failures.top[0].address} (${failures.top[0].count.toLocaleString('en-US')})`;
    return `${failures.count.toLocaleString('en-US')} failed sign-in tries in the last ${failures.hours} hours (a wrong password, an unknown user, no key), from ${failures.addresses.toLocaleString('en-US')} ${(failures.addresses === 1) ? 'address' : 'addresses'}${top}.`;
}

function updates_of(updates)
{
    const said = updates_check(updates);
    if (said === null) {
        return check('updates', 'Updates', 'none', 'not counted', 'Its agent has not counted its updates.', null);
    }
    return Object.assign(said, {tab: ((said.state === 'warn') && (said.text !== 'restart wanted')) ? 'configure' : null});
}

function auto_check(seen)
{
    if (seen.facts === null) {
        return check('auto', 'Auto updates', 'none', 'not read', seen.errors.facts, null);
    }
    const auto = seen.facts.auto_updates;
    if ((auto === null) || (auto === undefined)) {
        return check('auto', 'Auto updates', 'none', 'not apt', 'Not a machine apt updates: nothing here to read.', null);
    }
    if (auto.installed === false) {
        return check('auto', 'Auto updates', 'warn', 'not installed', 'unattended-upgrades is not installed: security updates wait for somebody to install them.\nsudo apt install unattended-upgrades', 'shell');
    }
    if (auto.on === false) {
        return check('auto', 'Auto updates', 'warn', 'off', `unattended-upgrades is installed and off (APT::Periodic::Unattended-Upgrade is ${(auto.setting === null) ? 'not set' : `"${auto.setting}"`}).\nsudo dpkg-reconfigure -plow unattended-upgrades`, 'shell');
    }
    return check('auto', 'Auto updates', 'ok', 'on', 'unattended-upgrades installs security updates by itself.', null);
}

// The release and the day its standard support ends, as the machine's own distro-info says
function system_check(seen, now)
{
    if (seen.facts === null) {
        return check('system', 'System', 'none', 'not read', seen.errors.facts, null);
    }
    const os = seen.facts.os;
    if ((os === null) || (os === undefined)) {
        return check('system', 'System', 'none', 'not known', 'The machine has no /etc/os-release.', null);
    }
    const version = os.version || os.id || 'unknown';
    if (os.eol === null) {
        return check('system', 'System', 'none', version, `${os.name}: the machine does not say when its support ends.`, null);
    }
    const ends = Date.parse(`${os.eol}T00:00:00Z`);
    const extended = (os.eol_extended === null) ? '' : ` Extended security support (${(os.id === 'ubuntu') ? 'Ubuntu Pro' : 'LTS'}) runs to ${os.eol_extended}, where it is on.`;
    if (ends <= now) {
        return check('system', 'System', 'bad', `${version} · ended`, `${os.name}: standard support ended ${os.eol}.${extended} A newer release gets its updates again.`, null);
    }
    if (ends - now < ENDING_MS) {
        const month = new Date(ends).toLocaleString('en-US', {month: 'short', year: 'numeric', timeZone: 'UTC'});
        return check('system', 'System', 'warn', `${version} · ends ${month}`, `${os.name}: standard support ends ${os.eol}.${extended}`, null);
    }
    return check('system', 'System', 'ok', version, `${os.name}: supported until ${os.eol}.`, null);
}

function check(key, label, state, text, detail, tab)
{
    return {key, label, state, text, detail: (detail === undefined) ? null : detail, tab};
}

module.exports = security_checks;
