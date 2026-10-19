// A `docker run` line, read as the fields a service is made of. People arrive holding one of
// these — from a README, from a note, from what they ran by hand yesterday — and typing it back
// in as six fields is work a browser can do.
//
// Anything that is not one of these comes back null, so the box it was pasted into goes on being
// an image name.

// Options that carry a value in the next word, or attached with = or right after the letter
const TAKES_VALUE = [
    '--name', '--network', '--net', '--publish', '-p', '--env', '-e', '--volume', '-v', '--mount',
    '--workdir', '-w', '--user', '-u', '--restart', '--memory', '-m', '--cpus', '--entrypoint',
    '--label', '-l', '--add-host', '--dns', '--env-file', '--health-cmd', '--hostname', '-h',
    '--log-driver', '--pull', '--platform', '--shm-size', '--stop-signal', '--sysctl', '--tmpfs',
    '--ulimit', '--device', '--cap-add', '--cap-drop', '--security-opt', '--group-add',
];

function docker_run_parse(text)
{
    const words = words_of(String(((text === undefined) || (text === null)) ? '' : text));
    const start = run_at(words);
    if (start === -1) {
        return null;
    }
    const out = {image: '', name: '', network: '', port: '', env: [], volumes: [], args: []};
    let i = start;
    while (i < words.length) {
        const word = words[i];
        if (word.startsWith('-') === false) {
            break;
        }
        const [option, value, ate] = option_at(words, i);
        i += ate;
        if (option === '--name') {
            out.name = value;
        }
        else if ((option === '--network') || (option === '--net')) {
            out.network = value;
        }
        else if ((option === '--publish') || (option === '-p')) {
            // The first one named, which in a README is the one the page is served on
            const port = inside_port(value);
            if ((port !== '') && (out.port === '')) {
                out.port = port;
            }
        }
        else if ((option === '--env') || (option === '-e')) {
            const mark = value.indexOf('=');
            if (mark > 0) {
                out.env.push({name: value.slice(0, mark), value: value.slice(mark + 1)});
            }
        }
        else if ((option === '--volume') || (option === '-v')) {
            out.volumes.push(volume_of(value));
        }
    }
    if (i >= words.length) {
        return null;
    }
    out.image = words[i];
    out.args = words.slice(i + 1);
    return out;
}

// Where the options begin: after `docker run`, however the line was invoked
function run_at(words)
{
    for (let i = 0; i < words.length - 1; i++) {
        if (((words[i] === 'docker') || (words[i] === 'podman')) && (words[i + 1] === 'run')) {
            return i + 2;
        }
    }
    return -1;
}

// One option and its value, and how many words that took: `-p 80:80`, `-p80:80`, `--publish=80:80`
function option_at(words, at)
{
    const word = words[at];
    const mark = word.indexOf('=');
    if (word.startsWith('--') && (mark !== -1)) {
        return [word.slice(0, mark), word.slice(mark + 1), 1];
    }
    if (TAKES_VALUE.includes(word)) {
        return [word, (words[at + 1] === undefined) ? '' : words[at + 1], 2];
    }
    // A short option with its value stuck to it, which docker allows and READMEs use
    if ((word.startsWith('--') === false) && (word.length > 2) && TAKES_VALUE.includes(word.slice(0, 2))) {
        return [word.slice(0, 2), word.slice(2), 1];
    }
    return [word, '', 1];
}

// The port inside the container, which is the last one named: `8080:3000`, `127.0.0.1:8080:3000/tcp`
function inside_port(value)
{
    const parts = value.split('/')[0].split(':');
    const last = parts[parts.length - 1];
    return /^\d+$/.test(last) ? last : '';
}

// `name:/path`, `/on/this/host:/path:ro`, or a bare `/path` serviceman keeps for itself
function volume_of(value)
{
    const parts = value.split(':');
    if (parts.length === 1) {
        return {source: '', target: parts[0], readonly: false};
    }
    return {
        source: parts[0],
        target: parts[1],
        readonly: parts.slice(2).includes('ro'),
    };
}

// The line as words, honouring quotes and the backslash that carries a line on to the next
function words_of(text)
{
    const out = [];
    let word = '';
    let quote = '';
    let held = false;
    for (const letter of text.replace(/\\\r?\n/g, ' ')) {
        if (held) {
            word += letter;
            held = false;
            continue;
        }
        if ((letter === '\\') && (quote !== "'")) {
            held = true;
            continue;
        }
        if (quote !== '') {
            if (letter === quote) {
                quote = '';
                continue;
            }
            word += letter;
            continue;
        }
        if ((letter === '"') || (letter === "'")) {
            quote = letter;
            continue;
        }
        if (/\s/.test(letter)) {
            if (word !== '') {
                out.push(word);
                word = '';
            }
            continue;
        }
        word += letter;
    }
    if (word !== '') {
        out.push(word);
    }
    return out;
}

export default docker_run_parse;
