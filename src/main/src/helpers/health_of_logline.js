const TIMEOUT_MS = 5000;

// Logline itself, asked as a machine or a visitor would reach it: its endpoint, where every
// machine's lines go, and its viewer, where Open Logline goes. Any answer at all is an answer;
// only a refusal, a drop or no answer in time is not. Before this, Logline's viewer could be
// down for hours with nothing said.
//
//     logline   the config's, null when nobody's lines go anywhere
//     out       [[key, {state, text, detail}]], as health_from_views reads `seen`
async function health_of_logline(logline)
{
    if (logline === null) {
        return [];
    }
    const asked = [ask('logline:endpoint', logline.endpoint, 'machines\' lines')];
    if ((logline.ui !== null) && (logline.ui !== undefined)) {
        asked.push(ask('logline:ui', logline.ui, 'Open Logline'));
    }
    return Promise.all(asked);
}

async function ask(key, url, what)
{
    const begin = Date.now();
    try {
        await fetch(url, {method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS)});
        return [key, {state: 'ok', text: `answers in ${Date.now() - begin} ms`, detail: url}];
    }
    catch (error) {
        const cause = ((error.cause === undefined) ? error.message : (error.cause.code || error.cause.message));
        return [key, {state: 'bad', text: 'does not answer', detail: `${url}: ${cause}. ${what} go nowhere: see that Logline runs there.`, cause: `nothing answers at ${url}: ${cause}`}];
    }
}

module.exports = health_of_logline;
