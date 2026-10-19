// How far a port reaches, most exposed first: the rank the list sorts by and the tone it is
// marked in — open is the internet, network is a private network or a tailnet
const EXPOSURE = {
    open: {rank: 0, tone: 'failed'},
    network: {rank: 1, tone: 'starting'},
    local: {rank: 2, tone: ''},
};

// The ports a machine listens on as rows, each with how far its address reaches and what the
// firewall does to it. One port held by one program over v4 and v6 is one row, as exposed as
// the most exposed of its addresses; the most exposed come first.
//
//     items      the sockets, as the agent lists them: {proto, address, port, state, users}
//     addresses  the machine's own addresses, null when its agent does not say
//     firewall   the module's answer: {installed, active, defaults, rules}, or null
//
//     -> [{key, port, proto, state, held, addresses, reach: {exposure, text, tone},
//          verdict: {kind: open | closed | local | unknown, text, rule, now}}]
function firewall_ports(items, addresses, firewall)
{
    const by_key = new Map();
    for (const item of items) {
        const held = item.users.map(v => `${v.name} · ${v.pid}`).join(', ');
        const key = `${item.proto}|${item.port}|${held}`;
        const reach = port_reach(item.address, addresses);
        if (by_key.has(key) === false) {
            by_key.set(key, {key, port: item.port, proto: item.proto.replace(/6$/, ''), state: item.state, held, addresses: [], reach});
        }
        const row = by_key.get(key);
        row.addresses.push(item.address);
        if (EXPOSURE[reach.exposure].rank < EXPOSURE[row.reach.exposure].rank) {
            row.reach = reach;
        }
    }
    const out = Array.from(by_key.values());
    for (const row of out) {
        row.reach.tone = EXPOSURE[row.reach.exposure].tone;
        row.verdict = verdict(row, firewall);
    }
    out.sort((a, b) => (EXPOSURE[a.reach.exposure].rank - EXPOSURE[b.reach.exposure].rank) || (a.port - b.port) || a.proto.localeCompare(b.proto));
    return out;
}

// What the firewall does to a port that others can reach: the first rule for it that holds for
// everyone decides, as ufw goes by the first match; rules for one source only are said beside
// it; with none, the default. While the firewall is off, the same is what it will do once on,
// and `now` says nothing stands in the way yet.
function verdict(row, firewall)
{
    if (row.reach.exposure === 'local') {
        return {kind: 'local', text: 'only this machine can reach it', rule: null, now: true};
    }
    if ((firewall === null) || (firewall.installed === false)) {
        return {kind: 'unknown', text: (firewall === null) ? '' : 'no ufw on this machine', rule: null, now: true};
    }
    const rules = firewall.rules.filter(v => rule_covers(v, row));
    const everyone = rules.find(v => v.from === 'any');
    const some = rules.filter(v => (v.from !== 'any') && ((everyone === undefined) || (rules.indexOf(v) < rules.indexOf(everyone))));
    const out = {kind: 'closed', text: '', rule: null, now: firewall.active};
    if (everyone !== undefined) {
        out.kind = ((everyone.action === 'allow') || (everyone.action === 'limit')) ? 'open' : 'closed';
        out.rule = everyone;
        out.text = (out.kind === 'open') ? ((everyone.action === 'limit') ? 'let in, slowed down' : 'let in') : 'kept out';
    }
    else {
        // ufw keeps incoming out unless told otherwise; while it is off, its status does not say
        const policy = (firewall.defaults === null) ? 'deny' : (firewall.defaults.incoming || 'deny');
        out.kind = (policy === 'allow') ? 'open' : 'closed';
        out.text = (out.kind === 'open') ? 'let in by the default' : 'kept out by the default';
    }
    const let_in = some.filter(v => (v.action === 'allow') || (v.action === 'limit')).map(v => v.from);
    if ((let_in.length > 0) && (out.kind === 'closed')) {
        out.text += `, but from ${let_in.join(', ')}`;
    }
    // The tab's head says the firewall is off; the row says what it will do once on
    if (firewall.active === false) {
        out.text = `once on: ${out.text}`;
    }
    return out;
}

// Whether a rule is about this port: incoming, its protocol or both, its port within the rule's
// ports or ranges, or a rule for every port (a source alone). ssh by name is port 22.
function rule_covers(rule, row)
{
    if (rule.direction !== 'in') {
        return false;
    }
    if ((rule.proto !== null) && (rule.proto !== row.proto)) {
        return false;
    }
    if (rule.app !== null) {
        return ((rule.app === 'ssh') || (rule.app === 'OpenSSH')) && (row.port === 22) && (row.proto === 'tcp');
    }
    if (rule.port === null) {
        return true;
    }
    return rule.port.split(',').some(function (part) {
        const range = part.split(':').map(Number);
        return (range.length === 1) ? range[0] === row.port : ((range[0] <= row.port) && (row.port <= range[1]));
    });
}

// Who can reach a port bound to this address. A socket on every address is as open as the
// most open address the machine has; with none known it is taken for open.
function port_reach(address, addresses)
{
    const kind = ip_kind(address);
    if (kind === 'loopback') {
        return {exposure: 'local', text: 'this machine only'};
    }
    if (kind === 'public') {
        return {exposure: 'open', text: 'a public address'};
    }
    if (kind === 'tailnet') {
        return {exposure: 'network', text: 'the tailnet'};
    }
    if ((kind === 'private') || (kind === 'link')) {
        return {exposure: 'network', text: (kind === 'link') ? 'the link-local network' : 'a private network'};
    }
    // A group's datagrams are sent on the network around; routers do not carry them in from the internet
    if ((kind === 'multicast') || (kind === 'broadcast')) {
        return {exposure: 'network', text: (kind === 'multicast') ? 'a multicast group' : 'a broadcast'};
    }
    if ((addresses === null) || (addresses.length === 0)) {
        return {exposure: 'open', text: 'every address'};
    }
    const open = addresses.some(v => ip_kind(v) === 'public');
    return {exposure: open ? 'open' : 'network', text: 'every address'};
}

// What kind of address a socket is bound to, from the text ss prints: every address, this
// machine alone, a tailnet, a private or link-local network, a multicast group or a broadcast,
// or the internet
function ip_kind(text)
{
    let address = String(text).toLowerCase().replace(/%.*$/, '');
    if ((address === '*') || (address === '0.0.0.0') || (address === '::')) {
        return 'any';
    }
    if (address.startsWith('::ffff:') && address.includes('.')) {
        address = address.slice(7);
    }
    if ((address === '::1') || (address === 'localhost')) {
        return 'loopback';
    }
    const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(address);
    if (v4 !== null) {
        const a = Number(v4[1]);
        const b = Number(v4[2]);
        if (a === 127) {
            return 'loopback';
        }
        if ((a === 100) && (b >= 64) && (b <= 127)) {
            return 'tailnet';
        }
        if ((a === 10) || ((a === 172) && (b >= 16) && (b <= 31)) || ((a === 192) && (b === 168))) {
            return 'private';
        }
        if ((a === 169) && (b === 254)) {
            return 'link';
        }
        if ((a >= 224) && (a <= 239)) {
            return 'multicast';
        }
        if (address === '255.255.255.255') {
            return 'broadcast';
        }
        return 'public';
    }
    if (address.startsWith('fd7a:115c:a1e0:')) {
        return 'tailnet';
    }
    if (/^f[cd]/.test(address)) {
        return 'private';
    }
    if (/^fe[89ab]/.test(address)) {
        return 'link';
    }
    if (address.startsWith('ff')) {
        return 'multicast';
    }
    return 'public';
}

export default firewall_ports;
