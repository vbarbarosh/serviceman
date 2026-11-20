// A program's command from the lines its card edits, as serviceman.json keeps it: the lines as
// they were written, one shell expression that /bin/sh -c runs, never joined into one; run as a
// group, wrapped in `sg <group> -c '…'`, a quote inside written as '\''. Blank lines before and
// after it, and spaces at the end of a line, go.
//
//     group     'render'
//     lines     ['./llama-server \\', '  -m bolt.gguf \\', '  --jinja', '']
//
//     'sg render -c \'./llama-server \\\n  -m bolt.gguf \\\n  --jinja\''
function service_command_join(group, lines)
{
    const inner = lines.map(v => v.trimEnd()).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    if ((group === '') || (inner === '')) {
        return inner;
    }
    return `sg ${group} -c '${inner.replaceAll('\'', '\'\\\'\'')}'`;
}

export default service_command_join;
