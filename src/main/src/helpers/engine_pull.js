const engine_call = require('./engine_call');
const engine_said = require('./engine_said');

// An image fetched onto the machine through the Engine API, unless it is there already. The
// engine says a failed pull as the last line of its progress, with an answer of 200 all the
// same, so the lines are read for it.
async function engine_pull(connect, image)
{
    const there = await engine_call(connect, 'GET', `/images/${encodeURIComponent(image)}/json`);
    if (there.status === 200) {
        return false;
    }
    const at = image.lastIndexOf(':');
    const answer = await engine_call(connect, 'POST', `/images/create?fromImage=${encodeURIComponent(image.slice(0, at))}&tag=${encodeURIComponent(image.slice(at + 1))}`);
    if (answer.status !== 200) {
        throw new Error(engine_said(answer));
    }
    for (const line of answer.body.split('\n')) {
        let said = null;
        try {
            said = JSON.parse(line);
        }
        catch {
            continue;
        }
        if ((said.error !== undefined) || (said.errorDetail !== undefined)) {
            throw new Error(`docker could not pull ${image}: ${said.error || said.errorDetail.message}`);
        }
    }
    return true;
}

module.exports = engine_pull;
