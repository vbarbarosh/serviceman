// A command as one line for /bin/sh: each word as it is where it is safe, quoted where it is
// not. Pasted into a shell, it runs the same argv again.
function argv_line(argv)
{
    return argv.map(quoted).join(' ');
}

function quoted(word)
{
    if (/^[a-zA-Z0-9_./:@=,%+-]+$/.test(word)) {
        return word;
    }
    return `'${String(word).replace(/'/g, "'\\''")}'`;
}

module.exports = argv_line;
