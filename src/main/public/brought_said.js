// A socket file's path as the config takes it, in characters
const SOCKET_MAX = 100;

// What the card "Its port on another machine" says under each of its boxes, and what an empty
// box stands for. Something typed that cannot work is said at once; a box nobody has filled in
// yet waits for Save (`tried`), as everywhere in the form.
//
//     brought  the card as brought_from_forwards gives it, changed by hand: a target's `remote`
//              is a machine's name, '' for none picked yet, or null for this host
//     program  {name, machine, port, remotes, tried}: its name, the one machine it runs on (null
//              for a list, a tag or none), the port its Runs card names ('' for none), the
//              machines of the config ({name, title, phase}), and whether Save was pressed
//
// Gives {port: {placeholder, value, text, bad}, targets: [{socket, port, value, text, bad, away}],
// problem}: an empty box's placeholder is the value it stands for, `value` what is written, `away`
// a word about a machine whose agent is not connected now, and `problem` the first thing wrong,
// or null.
function brought_said(brought, program)
{
    const port = port_said(brought, program);
    const targets = [];
    for (let i = 0, end = brought.targets.length; i < end; ++i) {
        targets.push(target_said(brought, i, port.value, program));
    }
    for (let i = 0, end = targets.length; i < end; ++i) {
        const target = brought.targets[i];
        const twin = brought.targets.findIndex((other, index) => (index < i) && (other.remote === target.remote) && (other.kind === target.kind) && (targets[index].value === targets[i].value));
        if ((targets[i].bad === false) && (target.remote !== '') && (twin !== -1)) {
            targets[i].text = 'a line above already brings it there: another socket file or port';
            targets[i].bad = true;
        }
    }
    const wrong = [port].concat(targets).find(v => v.bad);
    return {port, targets, problem: (wrong === undefined) ? null : wrong.text};
}

// The port it listens on: typed, or the one its Runs card names
function port_said(brought, program)
{
    const value = (brought.port === '') ? program.port : brought.port;
    const placeholder = (program.port === '') ? '8080' : program.port;
    if ((brought.targets.length > 0) && (program.machine === null)) {
        return {placeholder, value, text: 'It is brought over from the one machine it runs on: name one under Where it runs, not a list or a tag.', bad: true};
    }
    if ((value !== '') && (port_is_good(value) === false)) {
        return {placeholder, value, text: 'A port is a whole number from 1 to 65535.', bad: true};
    }
    if (value === '') {
        const bad = program.tried && (brought.targets.length > 0);
        return {placeholder, value, text: bad ? 'The port it listens on is needed, to be brought over.' : 'The port it listens on, on the loopback of its machine.', bad};
    }
    const place = (program.machine === null) ? 'its machine' : title_of(program, program.machine);
    if (brought.port === '') {
        return {placeholder, value, text: `Left empty, it is ${value}, its port under What runs: 127.0.0.1:${value} on ${place}.`, bad: false};
    }
    return {placeholder, value, text: `127.0.0.1:${value} on ${place}: the port it listens on.`, bad: false};
}

// One machine it is brought to: what is there, or what is wrong with it. This host, where
// serviceman runs, listens itself, with no agent: a socket file inside its state dir.
function target_said(brought, index, port, program)
{
    const target = brought.targets[index];
    const here = (target.remote === null);
    const own = (here === false) && (target.remote === program.machine);
    const socket = socket_default(brought, index, program.name);
    const port_default = own ? '' : port;
    const value = (target.kind === 'socket') ? ((target.socket === '') ? socket : target.socket) : ((target.port === '') ? port_default : target.port);
    const out = {socket, port: port_default, value, text: '', bad: false, away: ''};
    if (target.remote === '') {
        out.text = 'Pick the machine it is brought to.';
        out.bad = program.tried;
        return out;
    }
    const title = title_of(program, target.remote);
    const machine = here ? undefined : program.remotes.find(v => v.name === target.remote);
    if ((machine !== undefined) && (machine.phase !== 'online')) {
        out.away = `${title}'s agent is not connected now: it listens once the agent dials in.`;
    }
    const wrong = (target.kind === 'socket') ? (here ? socket_here_wrong(value) : socket_wrong(value)) : port_wrong(value, own ? port : null, title);
    if (wrong !== null) {
        out.text = wrong;
        out.bad = (value !== '') || program.tried;
        return out;
    }
    if (here) {
        out.text = (target.kind === 'socket') ? `${value} in serviceman's state dir, on this host: a socket file only serviceman's user may open.` : `Port ${value} on the loopback of this host, where serviceman runs, 127.0.0.1 and nowhere else.`;
        return out;
    }
    if (target.kind === 'socket') {
        out.text = own ? `${value} on ${title}, beside it: a socket file only its agent's user may open, and its agent joins the two itself.` : `${value} on ${title}: a socket file only its agent's user may open; ~ is that user's home.`;
        return out;
    }
    out.text = own ? `Port ${value} on the loopback of ${title}, beside it: its agent joins the two itself.` : `Port ${value} on the loopback of ${title}, 127.0.0.1 and nowhere else.`;
    return out;
}

// What is wrong with a socket file's path, or null
function socket_wrong(value)
{
    if ((value.startsWith('/') || value.startsWith('~/')) === false) {
        return 'A socket file from / or ~/, as ~/.sockets/llm.sock.';
    }
    if (value.length > SOCKET_MAX) {
        return `A socket file's path of at most ${SOCKET_MAX} characters: this one has ${value.length}.`;
    }
    return null;
}

// What is wrong with a socket file of serviceman itself, or null: a path inside its state dir,
// written from it, as forward_here_parse takes it
function socket_here_wrong(value)
{
    if (value.startsWith('/') || value.startsWith('~')) {
        return 'A socket file inside serviceman\'s state dir, written from it: sockets/llm.sock.';
    }
    if (value.split('/').some(v => ['', '.', '..'].includes(v))) {
        return 'A path that stays inside serviceman\'s state dir, with no .. in it: sockets/llm.sock.';
    }
    if (value.length > SOCKET_MAX) {
        return `A socket file's path of at most ${SOCKET_MAX} characters: this one has ${value.length}.`;
    }
    return null;
}

// What is wrong with a port there, or null. `taken` is the program's own port when it is the
// program's machine: listening there too, each connection would reach itself.
function port_wrong(value, taken, title)
{
    if ((value === '') && (taken === null)) {
        return `A port on ${title}: the one it listens on, or another.`;
    }
    if (value === '') {
        return (taken === '') ? `On ${title} itself, a port of its own.` : `On ${title} itself, a port of its own: ${taken} is the program's.`;
    }
    if (port_is_good(value) === false) {
        return 'A port is a whole number from 1 to 65535.';
    }
    if (value === taken) {
        return `${taken} is where the program listens on ${title}: another port, or a socket file.`;
    }
    return null;
}

// A socket file named after the program, in a folder kept for sockets that the agent makes the
// first time: ~/.sockets/llm.sock, then ~/.sockets/llm-2.sock for a second one on that machine.
// On this host it is serviceman's: sockets/llm.sock in its state dir.
function socket_default(brought, index, name)
{
    const target = brought.targets[index];
    const before = brought.targets.slice(0, index).filter(v => (v.remote === target.remote) && (v.kind === 'socket')).length;
    const base = (name === '') ? 'its-name' : name;
    const folder = (target.remote === null) ? 'sockets' : '~/.sockets';
    return (before === 0) ? `${folder}/${base}.sock` : `${folder}/${base}-${before + 1}.sock`;
}

function port_is_good(text)
{
    const port = Number(text);
    return /^\d+$/.test(text) && (port >= 1) && (port <= 65535);
}

// A machine's title, or this host for serviceman's own
function title_of(program, name)
{
    if (name === null) {
        return 'this host';
    }
    const found = program.remotes.find(v => v.name === name);
    return ((found === undefined) || (found.title === null) || (found.title === undefined) || (found.title === '')) ? name : found.title;
}

export default brought_said;
