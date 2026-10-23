// What a module says one kind of its items is, from the manifests serviceman answers at
// /api/v1/modules: its columns, its key, what it is searched by, how it stands as a tree. The
// manifests are read once a page, by the first table that asks, and every other one waits for
// that same read.
let loading = null;

// The ways a column is shown (items_view): as it is, as code, a size, a count, a time it took,
// how long ago, a share with its bar (percent: the value is one; share: of another field), a
// flag said in words (yes, no)
const AS = ['text', 'code', 'bytes', 'count', 'duration', 'ago', 'percent', 'share', 'flag'];

async function module_kind(module, kind)
{
    if (loading === null) {
        loading = modules_read();
        // A read that failed is tried again by the next table that asks
        loading.catch(function () {
            loading = null;
        });
    }
    const modules = await loading;
    for (const found of modules) {
        if (found.module !== module) {
            continue;
        }
        const out = found.kinds.find(v => (v.kind === kind));
        if ((out !== undefined) && Array.isArray(out.columns)) {
            return out;
        }
    }
    throw new Error(`no module ${module} has items of the kind ${JSON.stringify(kind)} with columns`);
}

async function modules_read()
{
    const answer = await fetch('/api/v1/modules', {cache: 'no-store'});
    const outcome = await answer.json();
    if (answer.ok === false) {
        throw new Error(outcome.error);
    }
    return outcome.modules;
}

module_kind.AS = AS;

export default module_kind;
