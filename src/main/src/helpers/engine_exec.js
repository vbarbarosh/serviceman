const engine_call = require('./engine_call');
const engine_said = require('./engine_said');
const http = require('http');

// A command run in a container through the Engine API: {code, stdout, stderr}. Its env goes in
// the request, never on a command line, which every user of the machine can read; so does
// nothing secret in `cmd`.
async function engine_exec(connect, container, cmd, env)
{
    const created = await engine_call(connect, 'POST', `/containers/${encodeURIComponent(container)}/exec`, {AttachStdout: true, AttachStderr: true, Tty: false, Cmd: cmd, Env: env || []});
    if (created.status !== 201) {
        throw new Error(engine_said(created));
    }
    const id = JSON.parse(created.body).Id;
    const out = await streams_read(connect, `/exec/${id}/start`, {Detach: false, Tty: false});
    const inspected = await engine_call(connect, 'GET', `/exec/${id}/json`);
    if (inspected.status !== 200) {
        throw new Error(engine_said(inspected));
    }
    out.code = JSON.parse(inspected.body).ExitCode;
    return out;
}

// What an exec writes, its two streams told apart by the 8 bytes before each frame
function streams_read(connect, pathname, value)
{
    return new Promise(function (resolve, reject) {
        const body = Buffer.from(JSON.stringify(value));
        const headers = {'host': 'docker', 'content-type': 'application/json', 'content-length': body.length};
        const request = http.request({createConnection: connect, method: 'POST', path: pathname, headers}, function (answer) {
            const chunks = [];
            answer.on('data', function (chunk) {
                chunks.push(chunk);
            });
            answer.on('end', function () {
                const all = Buffer.concat(chunks);
                if (answer.statusCode !== 200) {
                    reject(new Error(engine_said({status: answer.statusCode, body: all.toString('utf8')})));
                    return;
                }
                resolve(frames_split(all));
            });
            answer.on('error', reject);
        });
        request.on('error', reject);
        request.end(body);
    });
}

function frames_split(all)
{
    const parts = {stdout: [], stderr: []};
    let at = 0;
    while ((at + 8) <= all.length) {
        const size = all.readUInt32BE(at + 4);
        const data = all.subarray(at + 8, at + 8 + size);
        parts[(all[at] === 2) ? 'stderr' : 'stdout'].push(data);
        at += 8 + size;
    }
    return {stdout: Buffer.concat(parts.stdout).toString('utf8'), stderr: Buffer.concat(parts.stderr).toString('utf8')};
}

module.exports = engine_exec;
