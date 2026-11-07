// dpkg's status file -> the version of each package installed, by name. A package kept only for
// its config files, or caught half way, is not installed; one of a second architecture
// (libc6:i386 beside libc6) keeps the version of the first.
//
//     -> {name: version}
function package_versions_from_status(text)
{
    const out = {};
    for (const stanza of text.split(/\n\s*\n/)) {
        const fields = {};
        for (const line of stanza.split('\n')) {
            const found = /^(Package|Status|Version):\s*(.*)$/.exec(line);
            if (found !== null) {
                fields[found[1]] = found[2].trim();
            }
        }
        if ((fields.Package === undefined) || (fields.Version === undefined) || (/ ok installed$/.test(fields.Status || '') === false)) {
            continue;
        }
        if (out[fields.Package] === undefined) {
            out[fields.Package] = fields.Version;
        }
    }
    return out;
}

module.exports = package_versions_from_status;
