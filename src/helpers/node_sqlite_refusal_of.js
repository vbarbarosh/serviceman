// The Node versions whose node:sqlite has all a SQLite file is read with: a database opened read
// only, and a statement's iterate, columns and setReturnArrays. 22.16 has them and 23.11, by
// their minor; every major from 24 on
const WHOLE_MINOR_BY_MAJOR = {22: 16, 23: 11};
const WHOLE_MAJOR = 24;

// Why the Node of `version`, as process.version says it, cannot read a SQLite file, in words;
// null when it can. node:sqlite is Node's own, so nothing is installed on a machine for it: a
// machine whose Node is older is told which one has it. The agent asks it of its own Node, and
// serviceman of a machine's, as its agent said it.
//
//     node_sqlite_refusal_of('v20.11.0')   // 'Node v20.11.0 has no node:sqlite whole, …'
//     node_sqlite_refusal_of('v22.16.0')   // null
function node_sqlite_refusal_of(version)
{
    const found = /^v(\d+)\.(\d+)\./.exec(String(version));
    const major = (found === null) ? 0 : Number(found[1]);
    const minor = (found === null) ? 0 : Number(found[2]);
    const least = WHOLE_MINOR_BY_MAJOR[major];
    if ((major >= WHOLE_MAJOR) || ((least !== undefined) && (minor >= least))) {
        return null;
    }
    return `Node ${version} has no node:sqlite whole, which SQLite files are read with: Node 22.16 and later have it`;
}

module.exports = node_sqlite_refusal_of;
