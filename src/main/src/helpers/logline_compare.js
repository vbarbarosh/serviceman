const logline_files = require('./logline_files');
const tunnel_open = require('./tunnel_open');

// Logline's files here against the same files in its folder on its machine, by sha256: same,
// differs, or missing there. The machine hashes them itself, and keeps a hash until the file
// changes, so asking again is cheap.
//
//     place   logline_place's
//     out     [{path, abs, state}], state same | differs | missing
async function logline_compare(app, place)
{
    const there = await tree_hashes(place.remote, place.dir);
    return logline_files().map(function (item) {
        const found = there.get(item.path);
        const state = (found === undefined) ? 'missing' : ((found === item.sha256) ? 'same' : 'differs');
        return {path: item.path, abs: item.abs, state};
    });
}

// Every file under the folder with its sha256, by its path in the folder
function tree_hashes(remote, dir)
{
    return new Promise(function (resolve, reject) {
        const hashes = new Map();
        let rest = '';
        let failed = null;
        let done = false;
        const stream = tunnel_open(remote, {tree: {path: dir, hash: true, skip: ['node_modules', 'data', '.git']}});
        stream.on('data', function (chunk) {
            const lines = (rest + chunk.toString('utf8')).split('\n');
            rest = lines.pop();
            for (const line of lines) {
                if (line === '') {
                    continue;
                }
                const item = JSON.parse(line);
                if ((item.type === 'file') && (typeof item.sha256 === 'string')) {
                    hashes.set(item.path, item.sha256);
                }
                if ((item.type === 'error') && ((item.path === undefined) || (item.path === ''))) {
                    failed = item.error;
                }
                if (item.type === 'end') {
                    done = true;
                }
            }
        });
        stream.on('error', reject);
        stream.on('end', function () {
            if ((failed !== null) || (done === false)) {
                reject(new Error(`${dir} on ${remote.name} cannot be read${(failed === null) ? '' : `: ${failed}`}`));
                return;
            }
            resolve(hashes);
        });
    });
}

module.exports = logline_compare;
