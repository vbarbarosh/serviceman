const engine_call = require('./engine_call');
const engine_said = require('./engine_said');
const tar_stream = require('./tar_stream');

// Files into a folder of a container, made or running, as one archive docker unpacks there:
// files [{name, bytes, mode}], mode 600 unless said
async function engine_files_put(connect, container, dir, files)
{
    const items = files.map(v => ({path: v.name, mode: (v.mode === undefined) ? 0o600 : v.mode, mtime_s: Math.floor(Date.now()/1000), size: v.bytes.length, stream: () => [v.bytes]}));
    const tar = Buffer.concat(await tar_stream(items).toArray());
    const answer = await engine_call(connect, 'PUT', `/containers/${encodeURIComponent(container)}/archive?path=${encodeURIComponent(dir)}`, tar, 'application/x-tar');
    if (answer.status !== 200) {
        throw new Error(engine_said(answer));
    }
}

module.exports = engine_files_put;
