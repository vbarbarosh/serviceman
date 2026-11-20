// A program's command as its card edits it: the shell expression as it is written, as lines.
// A command written over several lines is shown as written. A command on one line is shown an
// option a line, every line but the last ending in ` \`, which the shell reads as that same one
// line; one run through `sg <group> -c '…'` keeps that around its lines, as it is written.
//
//     command   'sg render -c \'./llama-server -m bolt.gguf --jinja\''
//
//     {lines: ['sg render -c \'./llama-server \\', '  -m bolt.gguf \\', '  --jinja\'']}
function service_command_lines(command)
{
    const text = String(command);
    if (text.trim().includes('\n')) {
        return {lines: text.replace(/^\s*\n/, '').trimEnd().split('\n')};
    }
    const found = /^(sg\s+\S+\s+-c\s+)'((?:[^']|'\\'')*)'\s*$/.exec(text);
    const inner = (found === null) ? text : found[2];
    const lines = [];
    for (const word of words_of(inner)) {
        // An option starts a line of its own, and so does what joins two commands; a value, a
        // negative number too, stays on the line of its option
        const starts = (/^-[^\d.]/.test(word) || ['&&', '||', '|', ';'].includes(word));
        if ((lines.length === 0) || starts) {
            lines.push((lines.length === 0) ? word : `  ${word}`);
            continue;
        }
        lines[lines.length - 1] += ` ${word}`;
    }
    // Every line but the last carried on to the next; sg's wrapper around them, as it is written
    const carried = lines.map((v, i) => (i < lines.length - 1) ? `${v} \\` : v);
    if ((found !== null) && (carried.length > 0)) {
        carried[0] = `${found[1]}'${carried[0]}`;
        carried[carried.length - 1] = `${carried[carried.length - 1]}'`;
    }
    return {lines: carried};
}

// The words of a line as they are written, quotes and all: a word ends at a space outside
// quotes, and a backslash keeps the character after it in the word
function words_of(line)
{
    const out = [];
    let word = '';
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if ((c === '\\') && (quote !== '\'') && (i + 1 < line.length)) {
            word += c + line[i + 1];
            i++;
            continue;
        }
        if (quote !== null) {
            quote = (c === quote) ? null : quote;
            word += c;
            continue;
        }
        if ((c === '\'') || (c === '"')) {
            quote = c;
            word += c;
            continue;
        }
        if (/\s/.test(c)) {
            if (word !== '') {
                out.push(word);
                word = '';
            }
            continue;
        }
        word += c;
    }
    if (word !== '') {
        out.push(word);
    }
    return out;
}

export default service_command_lines;
