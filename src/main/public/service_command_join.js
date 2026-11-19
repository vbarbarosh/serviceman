// A program's command from the lines its card edits, as serviceman.json keeps it: the lines
// joined with single spaces into one, or kept as lines for a script; run as a group, wrapped
// in `sg <group> -c '…'`, a quote inside written as '\''. A line that ends in a backslash, as a
// pasted command often does, loses it.
//
//     group     'render'
//     lines     ['./llama-server', '  -m bolt.gguf \\', '', '  --jinja']
//     script    false
//
//     'sg render -c \'./llama-server -m bolt.gguf --jinja\''
function service_command_join(group, lines, script)
{
    const inner = script ? lines.map(v => v.trimEnd()).join('\n').trim() : lines.map(v => v.trim().replace(/\s*\\$/, '')).filter(v => v !== '').join(' ');
    if ((group === '') || (inner === '')) {
        return inner;
    }
    return `sg ${group} -c '${inner.replaceAll('\'', '\'\\\'\'')}'`;
}

export default service_command_join;
