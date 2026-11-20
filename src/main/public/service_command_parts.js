// A command line as the Overview reads it: the group it runs as when it is
// `sg <group> -c '…'`, the words before the program (`sg render -c`), the program, and each
// option with its value. `--ctx-size 65536` is one option, `--jinja` one with no value, a word
// with no flag before it one with no flag.
//
//     line      'sg render -c \'./llama-server -m bolt.gguf --jinja\''
//
//     {group: 'render', lead: 'sg render -c', program: './llama-server',
//      options: [{flag: '-m', value: 'bolt.gguf'}, {flag: '--jinja', value: ''}]}
function service_command_parts(line)
{
    let words = words_of(line);
    let group = '';
    let lead = '';
    if ((words.length === 4) && (words[0] === 'sg') && (words[2] === '-c')) {
        group = words[1];
        lead = `sg ${group} -c`;
        words = words_of(words[3]);
    }
    const options = [];
    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        // A flag that carries its value, --port=8080, takes no word after it
        if (word.startsWith('-') && word.includes('=')) {
            options.push({flag: word, value: ''});
            continue;
        }
        if (word.startsWith('-')) {
            const next = words[i + 1];
            if ((next !== undefined) && (next.startsWith('-') === false)) {
                options.push({flag: word, value: next});
                i++;
                continue;
            }
            options.push({flag: word, value: ''});
            continue;
        }
        options.push({flag: '', value: word});
    }
    return {group, lead, program: (words.length === 0) ? '' : words[0], options};
}

// The words of a command line, as a shell splits them: quotes keep their spaces and are taken
// off, and a backslash outside them keeps the character after it ('\'' is a quote in quotes),
// or, at a line's end, carries the line on to the next
function words_of(line)
{
    const out = [];
    let word = null;
    let quote = null;
    let escaped = false;
    for (const c of String(line)) {
        // A backslash at a line's end carries the line on to the next, and is nothing itself
        if (escaped && (c === '\n')) {
            escaped = false;
            continue;
        }
        if (escaped) {
            word = (word === null) ? c : (word + c);
            escaped = false;
            continue;
        }
        if ((c === '\\') && (quote === null)) {
            escaped = true;
            continue;
        }
        if (quote !== null) {
            if (c === quote) {
                quote = null;
            }
            else {
                word += c;
            }
            continue;
        }
        if ((c === '\'') || (c === '"')) {
            quote = c;
            word = (word === null) ? '' : word;
            continue;
        }
        if (/\s/.test(c)) {
            if (word !== null) {
                out.push(word);
                word = null;
            }
            continue;
        }
        word = (word === null) ? c : (word + c);
    }
    if (word !== null) {
        out.push(word);
    }
    return out;
}

export default service_command_parts;
