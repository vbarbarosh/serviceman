// The system as /etc/os-release names it: its id (ubuntu, debian), its version, the name it
// gives itself for people, and the codename the release files list it under. A value may be
// quoted either way, or not at all; one the file does not have is null.
//
//     -> {id, version, name, codename}
function os_from_release(text)
{
    const values = new Map();
    for (const line of text.split('\n')) {
        const found = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
        if (found !== null) {
            values.set(found[1], unquoted(found[2]));
        }
    }
    return {
        id: (values.get('ID') || '').toLowerCase() || null,
        version: values.get('VERSION_ID') || null,
        name: values.get('PRETTY_NAME') || null,
        codename: values.get('VERSION_CODENAME') || values.get('UBUNTU_CODENAME') || null,
    };
}

function unquoted(text)
{
    const value = text.trim();
    if ((value.length >= 2) && ((value[0] === '"') || (value[0] === '\'')) && (value[value.length - 1] === value[0])) {
        return value.slice(1, -1);
    }
    return value;
}

module.exports = os_from_release;
