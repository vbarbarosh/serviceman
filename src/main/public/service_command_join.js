// A program's command from the lines its card edits, as serviceman.json keeps it: the lines as
// they were written, one shell expression that /bin/sh -c runs, never joined into one. Blank
// lines before and after it, and spaces at the end of a line, go.
//
//     lines     ['./llama-server \\', '  -m bolt.gguf \\', '  --jinja', '']
//
//     './llama-server \\\n  -m bolt.gguf \\\n  --jinja'
function service_command_join(lines)
{
    return lines.map(v => v.trimEnd()).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

export default service_command_join;
