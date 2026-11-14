const child_process = require('child_process');
const dgram = require('dgram');
const log_event = require('./log_event');

// How long a name it says is kept by whoever asked: short, so a new address is taken soon
const TTL_S = 60;
// How often the tailnet is asked for this machine's address until it says one
const ADDRESS_EVERY_MS = 30000;

const TYPE_A = 1;
const CLASS_IN = 1;
const RCODE_SERVFAIL = 2;
const RCODE_REFUSED = 5;

// The names of the apps on the tailnet: a DNS answer, on a UDP port, for the apps domain and
// every name under it, each the address of this machine, so notes.apps.example.com reaches the
// app on any device of the tailnet. Tailscale's admin sends the domain's questions here (split
// DNS); nothing else is answered: a name outside the domain is refused. The address is the
// config's apps.address, or the tailnet's own word for this machine, `tailscale ip -4`, asked
// until it says one.
//
//     null where the config asks for no DNS (apps.dns)
//     {socket, ready, address(), close()}   ready settles once the port listens
function apps_dns_start(app)
{
    const apps = app.config.apps;
    if ((apps.dns === null) || (apps.domain === null)) {
        return null;
    }
    const state = {address: apps.address, timer: null};
    const socket = dgram.createSocket('udp4');
    socket.on('message', function (message, from) {
        const answer = dns_answer(message, apps.domain, state.address);
        if (answer !== null) {
            socket.send(answer, from.port, from.address);
        }
    });
    socket.on('error', function (error) {
        log_event(app, 'apps_dns_error', {port: apps.dns, reason: error.message});
    });
    const ready = new Promise(function (resolve) {
        socket.bind(apps.dns, function () {
            log_event(app, 'apps_dns_listen', {port: socket.address().port, domain: apps.domain, address: state.address || 'asking tailscale'});
            resolve();
        });
    });
    if (state.address === null) {
        address_ask(app, state);
    }
    return {
        socket,
        ready,
        address: () => state.address,
        close: function () {
            clearTimeout(state.timer);
            socket.close();
        },
    };
}

// This machine's tailnet address, as tailscale says it; asked again a while later until it does
function address_ask(app, state)
{
    child_process.execFile('tailscale', ['ip', '-4'], {timeout: 5000}, function (error, stdout) {
        const found = String(stdout || '').split('\n').map(v => v.trim()).find(v => /^\d+\.\d+\.\d+\.\d+$/.test(v));
        if ((error === null) && (found !== undefined)) {
            state.address = found;
            log_event(app, 'apps_dns_address', {address: found});
            return;
        }
        state.timer = setTimeout(() => address_ask(app, state), ADDRESS_EVERY_MS);
        state.timer.unref();
    });
}

// One question, its answer: the address for an A under the domain, an empty answer for any
// other type there (the asker then takes the A), refused outside it, and a failure while no
// address is known. null for what is no question at all.
function dns_answer(message, domain, address)
{
    if (message.length < 12) {
        return null;
    }
    const flags = message.readUInt16BE(2);
    const questions = message.readUInt16BE(4);
    // A question, not an answer, and one of it: what every resolver sends
    if (((flags & 0x8000) !== 0) || (questions !== 1)) {
        return null;
    }
    const read = question_read(message);
    if (read === null) {
        return null;
    }
    const name = read.labels.join('.').toLowerCase();
    const ours = (name === domain) || name.endsWith(`.${domain}`);
    let rcode = 0;
    if (ours === false) {
        rcode = RCODE_REFUSED;
    }
    else if ((address === null) && (read.type === TYPE_A)) {
        rcode = RCODE_SERVFAIL;
    }
    const answers = ((rcode === 0) && (read.type === TYPE_A) && (read.klass === CLASS_IN)) ? 1 : 0;
    const head = Buffer.alloc(12);
    message.copy(head, 0, 0, 2);
    // A response, its answer authoritative, the asker's wish to recurse kept, and the code
    head.writeUInt16BE(0x8000 | 0x0400 | (flags & 0x0100) | rcode, 2);
    head.writeUInt16BE(1, 4);
    head.writeUInt16BE(answers, 6);
    const parts = [head, message.subarray(12, read.end)];
    if (answers === 1) {
        const record = Buffer.alloc(16);
        // The name: a pointer to the question's, at 12
        record.writeUInt16BE(0xc00c, 0);
        record.writeUInt16BE(TYPE_A, 2);
        record.writeUInt16BE(CLASS_IN, 4);
        record.writeUInt32BE(TTL_S, 6);
        record.writeUInt16BE(4, 10);
        for (const [i, part] of address.split('.').entries()) {
            record.writeUInt8(Number(part), 12 + i);
        }
        parts.push(record);
    }
    return Buffer.concat(parts);
}

// The question's name as labels, its type and class, and where it ends; null for one that
// runs past the message or points elsewhere, which a question never does
function question_read(message)
{
    const labels = [];
    let at = 12;
    for (;;) {
        if (at >= message.length) {
            return null;
        }
        const length = message.readUInt8(at);
        if (length === 0) {
            at += 1;
            break;
        }
        if ((length & 0xc0) !== 0) {
            return null;
        }
        if (at + 1 + length > message.length) {
            return null;
        }
        labels.push(message.toString('latin1', at + 1, at + 1 + length));
        at += 1 + length;
    }
    if (at + 4 > message.length) {
        return null;
    }
    return {labels, type: message.readUInt16BE(at), klass: message.readUInt16BE(at + 2), end: at + 4};
}

apps_dns_start.answer = dns_answer;

module.exports = apps_dns_start;
