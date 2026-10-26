const BODY_LIMIT_BYTES = 16*1024;

const ACTIONS = ['allow', 'deny', 'reject', 'limit'];
const PROTOS = ['tcp', 'udp', 'any'];
const DIRECTIONS = ['in', 'out'];
// A port, a range or a list of them, as ufw takes them: 22, 8000:8100, 80,443
const RE_PORTS = /^\d{1,5}([:,]\d{1,5})*$/;
// An address or a network, either kind: what ufw takes after from
const RE_ADDRESS = /^([0-9.]{7,15}|[0-9a-fA-F:]{2,39})(\/\d{1,3})?$/;
const COMMENT_MAX = 200;

// The firewall of one machine, ufw, and the ports it listens on, under whatever base the host
// mounts it at. The host gives `run(argv)`, which runs ufw with those words as root on the
// machine and answers {ok, code, stdout, stderr}, and `ports()`, the sockets it listens on:
// {items: [{proto, address, port, state, users: [{name, pid}]}], commands}. The rules are the
// ones ufw lists as added, one a rule, each the command that made it: so a rule is the same
// whether the firewall is on or off, it is deleted by what it is rather than by a number that
// moves, and Undo is that command run again.
//
//     options = {run, ports, tail, log}
async function firewall_serve(req, res, options)
{
    const ctx = {
        run: options.run,
        ports: options.ports,
        log: (options.log === undefined) ? function () {} : options.log,
    };
    const tail = options.tail;
    try {
        // GET <base>
        if (((tail === '') || (tail === '/')) && (req.method === 'GET')) {
            send_json(res, 200, await state_read(ctx));
            return;
        }
        // GET <base>/ports
        if ((tail === '/ports') && (req.method === 'GET')) {
            if (ctx.ports === undefined) {
                send_json(res, 501, {error: 'the ports of this machine cannot be read here'});
                return;
            }
            send_json(res, 200, await ctx.ports());
            return;
        }
        // GET <base>/rules
        if ((tail === '/rules') && (req.method === 'GET')) {
            send_json(res, 200, {items: (await state_read(ctx)).rules});
            return;
        }
        // POST <base>/rules (body)
        if ((tail === '/rules') && (req.method === 'POST')) {
            await rule_add_serve(ctx, req, res);
            return;
        }
        // POST <base>/rules/delete (body)
        if ((tail === '/rules/delete') && (req.method === 'POST')) {
            await rule_delete_serve(ctx, req, res);
            return;
        }
        // POST <base>/enable
        // POST <base>/disable
        if (((tail === '/enable') || (tail === '/disable')) && (req.method === 'POST')) {
            await switch_serve(ctx, res, tail.slice(1));
            return;
        }
        send_json(res, 404, {error: `no such door: ${tail}`});
    }
    catch (error) {
        send_json(res, (error.status === undefined) ? 502 : error.status, {error: error.message});
    }
}

// Whether ufw is there and on, its defaults while it is on, and its rules as added
async function state_read(ctx)
{
    const status = await ctx.run(['status', 'verbose']);
    if ((status.ok === false) && /not found|No such file/.test(status.stderr)) {
        return {installed: false, active: false, defaults: null, logging: null, rules: [], ssh_open: false};
    }
    refused_throw(status);
    const added = await ctx.run(['show', 'added']);
    refused_throw(added);
    const rules = rules_from_added(added.stdout);
    return {
        installed: true,
        active: /^Status: active/m.test(status.stdout),
        defaults: defaults_from_status(status.stdout),
        logging: line_value(status.stdout, 'Logging'),
        rules,
        ssh_open: rules.some(ssh_lets_in),
    };
}

// POST <base>/rules (body)
// A rule from the form, {action, direction, port, proto, from, comment}, added last; or
// {command, at}, a rule as the list gave it, which is how a deleted one comes back: at its old
// place, since the first rule that matches is the one ufw goes by
async function rule_add_serve(ctx, req, res)
{
    const body = await body_json(req);
    const argv = (typeof body.command === 'string') ? command_argv_checked(body.command) : argv_from_form(body);
    const before = await state_read(ctx);
    // ufw says it inserted a rule past the last one, and adds nothing: that one is added last
    const at = Number(body.at);
    if (Number.isInteger(at) && (at >= 1) && (at <= before.rules.length)) {
        const inserted = await ctx.run(['insert', String(at)].concat(argv));
        if (inserted.ok && (/^ERROR:/m.test(inserted.stdout + inserted.stderr) === false)) {
            said_throw(inserted);
            ctx.log('ufw_rule_added', {rule: argv_text(argv), at});
            send_json(res, 200, await state_read(ctx));
            return;
        }
    }
    const answer = await ctx.run(argv);
    said_throw(answer);
    ctx.log('ufw_rule_added', {rule: argv_text(argv)});
    send_json(res, 200, await state_read(ctx));
}

// POST <base>/rules/delete (body)
// {command}: one rule of the list, gone. It has to be in the list still, word for word, so a
// rule changed by somebody else meanwhile is not taken for it. The answer says how to bring it
// back, and where: {command, at}.
async function rule_delete_serve(ctx, req, res)
{
    const body = await body_json(req);
    const command = String(body.command || '');
    const before = await state_read(ctx);
    const at = before.rules.findIndex(v => v.command === command) + 1;
    if (at === 0) {
        throw status_error(409, `there is no rule "${command}" any more; the list has changed`);
    }
    const argv = command_argv_checked(command);
    const answer = await ctx.run(['delete'].concat(argv));
    said_throw(answer);
    ctx.log('ufw_rule_deleted', {rule: command});
    send_json(res, 200, Object.assign(await state_read(ctx), {undo: {command, at}}));
}

// POST <base>/enable
// POST <base>/disable
// ufw asks whether to go on when it is turned on over ssh; --force is that answer given ahead
async function switch_serve(ctx, res, action)
{
    const answer = await ctx.run((action === 'enable') ? ['--force', 'enable'] : ['disable']);
    said_throw(answer);
    ctx.log((action === 'enable') ? 'ufw_enabled' : 'ufw_disabled', {});
    send_json(res, 200, await state_read(ctx));
}

// The form's fields as ufw's words. The short form when nothing but a port is given, the long
// one when there is a source or a comment; both are what a person would type.
function argv_from_form(body)
{
    const action = String(body.action || '');
    const direction = String(body.direction || 'in');
    const port = String(body.port || '').trim();
    const proto = String(body.proto || 'any');
    const from = String(body.from || '').trim();
    const comment = String(body.comment || '').trim();
    if (ACTIONS.includes(action) === false) {
        throw status_error(400, `an action is one of ${ACTIONS.join(', ')}`);
    }
    if (DIRECTIONS.includes(direction) === false) {
        throw status_error(400, 'a direction is in or out');
    }
    if (PROTOS.includes(proto) === false) {
        throw status_error(400, `a protocol is one of ${PROTOS.join(', ')}`);
    }
    if ((RE_PORTS.test(port) === false) || port.split(/[:,]/).some(v => (Number(v) < 1) || (Number(v) > 65535))) {
        throw status_error(400, 'a port is a number from 1 to 65535, a range like 8000:8100, or a list like 80,443');
    }
    if (/[:,]/.test(port) && (proto === 'any')) {
        throw status_error(400, 'a range or a list of ports needs tcp or udp; ufw takes no both for them');
    }
    if ((from !== '') && (from !== 'any') && (RE_ADDRESS.test(from) === false)) {
        throw status_error(400, 'from is an address or a network, like 10.0.0.0/8; empty is anywhere');
    }
    if (comment.includes('\'') || comment.includes('\n') || (comment.length > COMMENT_MAX)) {
        throw status_error(400, `a comment is one line of up to ${COMMENT_MAX} characters, with no '`);
    }
    const out = [action];
    if (direction === 'out') {
        out.push('out');
    }
    if (((from === '') || (from === 'any')) && (comment === '')) {
        out.push((proto === 'any') ? port : `${port}/${proto}`);
        return out;
    }
    out.push('from', (from === '') ? 'any' : from, 'to', 'any', 'port', port);
    if (proto !== 'any') {
        out.push('proto', proto);
    }
    if (comment !== '') {
        out.push('comment', comment);
    }
    return out;
}

// A rule as the list says it, back to ufw's words: only a rule, never another subcommand
function command_argv_checked(command)
{
    const out = words_split(command);
    if (ACTIONS.includes(out[0]) === false) {
        throw status_error(400, `a rule starts with ${ACTIONS.join(', ')}`);
    }
    return out;
}

// `ufw show added`: one line a rule, each the command that made it
//
//     ufw allow from 10.0.0.0/8 to any port 5432 proto tcp comment 'db from the lan'
function rules_from_added(text)
{
    const out = [];
    for (const line of text.split('\n')) {
        if (line.startsWith('ufw ') === false) {
            continue;
        }
        const command = line.slice('ufw '.length).trim();
        out.push(Object.assign({command}, rule_fields(words_split(command))));
    }
    return out;
}

// What a rule says, for a table: the action, which way, the port and protocol (or the name of
// a service), from where, to where, on which interface, and its comment
function rule_fields(argv)
{
    const out = {action: argv[0], direction: 'in', port: null, proto: null, from: 'any', to: 'any', on: null, comment: null, app: null};
    for (let i = 1; i < argv.length; i++) {
        const word = argv[i];
        const next = argv[i + 1];
        if (((word === 'in') || (word === 'out')) && (i === 1)) {
            out.direction = word;
            continue;
        }
        if (['from', 'to', 'port', 'proto', 'comment', 'app', 'on'].includes(word) && (next !== undefined)) {
            out[word] = next;
            i++;
            continue;
        }
        // The short form's one word: a port with its protocol, or a service by name; ufw keeps
        // a comment after it (deny out 25/tcp comment 'no mail out')
        const one = word.split('/');
        if (/^[\d:,]+$/.test(one[0])) {
            out.port = one[0];
            out.proto = (one[1] === undefined) ? null : one[1];
        }
        else {
            out.app = word;
        }
    }
    return out;
}

// Whether a rule lets ssh in: allow or limit, incoming, port 22 or the service by name, from
// anywhere or somewhere
function ssh_lets_in(rule)
{
    if (((rule.action !== 'allow') && (rule.action !== 'limit')) || (rule.direction !== 'in')) {
        return false;
    }
    if ((rule.app === 'ssh') || (rule.app === 'OpenSSH')) {
        return true;
    }
    if ((rule.port === null) || ((rule.proto !== null) && (rule.proto !== 'tcp'))) {
        return false;
    }
    return rule.port.split(',').some(function (part) {
        const range = part.split(':').map(Number);
        return (range.length === 1) ? range[0] === 22 : ((range[0] <= 22) && (22 <= range[1]));
    });
}

// Default: deny (incoming), allow (outgoing), deny (routed)
function defaults_from_status(text)
{
    const line = line_value(text, 'Default');
    if (line === null) {
        return null;
    }
    const out = {};
    for (const part of line.split(',')) {
        const found = /^\s*(\S+)\s+\((\w+)\)/.exec(part);
        if (found !== null) {
            out[found[2]] = found[1];
        }
    }
    return out;
}

function line_value(text, name)
{
    const found = new RegExp(`^${name}: (.*)$`, 'm').exec(text);
    return (found === null) ? null : found[1].trim();
}

// Words the way a shell splits them, which is how ufw writes a comment: in single quotes
function words_split(text)
{
    const out = [];
    const re = /'([^']*)'|(\S+)/g;
    let found;
    while ((found = re.exec(text)) !== null) {
        out.push((found[1] === undefined) ? found[2] : found[1]);
    }
    return out;
}

function argv_text(argv)
{
    return argv.map(v => /\s/.test(v) ? `'${v}'` : v).join(' ');
}

// What ufw said when it could not be run at all, or refused: as the error
function refused_throw(answer)
{
    if (answer.ok) {
        return;
    }
    const text = `${answer.stderr}\n${answer.stdout}`.trim();
    if (/sudo:.*(password|no tty|askpass)/.test(text)) {
        throw status_error(502, 'ufw needs root, and sudo on that machine asked for a password: give it a root agent');
    }
    throw status_error(502, reason_of(answer) || `ufw ended with ${answer.code}`);
}

// Why ufw refused, in one line: its ERROR line, else the last of stderr, else of stdout. What
// came last on stdout is only where it stopped, not why.
function reason_of(answer)
{
    const errors = String(answer.stderr || '').split('\n').filter(v => v.trim() !== '');
    const flagged = errors.filter(v => /^(ERROR\b|error\b|E:)/.test(v.trim()));
    if (flagged.length > 0) {
        return flagged[flagged.length - 1].trim();
    }
    if (errors.length > 0) {
        return errors[errors.length - 1].trim();
    }
    const said = String(answer.stdout || '').split('\n').filter(v => v.trim() !== '');
    return (said.length === 0) ? null : said[said.length - 1].trim();
}

// ufw answers 0 to a few refusals and says them on stdout: a rule it could not find, one it
// already has
function said_throw(answer)
{
    refused_throw(answer);
    const text = `${answer.stdout}\n${answer.stderr}`;
    const said = /^ERROR: (.*)$/m.exec(text);
    if (said !== null) {
        throw status_error(400, said[1]);
    }
    if (/Could not delete non-existent rule/.test(text)) {
        throw status_error(409, 'ufw has no such rule any more');
    }
    if (/^Skipping adding existing rule/m.test(text) && (/Rule(s)? (added|updated)/.test(text) === false)) {
        throw status_error(409, 'ufw has this rule already');
    }
}

function status_error(status, message)
{
    const out = new Error(message);
    out.status = status;
    return out;
}

function body_json(req)
{
    return new Promise(function (resolve, reject) {
        const chunks = [];
        let bytes = 0;
        req.on('data', function (chunk) {
            bytes += chunk.length;
            if (bytes > BODY_LIMIT_BYTES) {
                reject(status_error(413, 'the body is too big'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', function () {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
            }
            catch {
                reject(status_error(400, 'the body is not JSON'));
            }
        });
        req.on('error', reject);
    });
}

function send_json(res, status, value)
{
    if (res.headersSent) {
        return;
    }
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(JSON.stringify(value, null, 4));
}

module.exports = firewall_serve;
