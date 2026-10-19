const TIMEOUT_MS = 5000;

// Logline's viewer, asked as a visitor would reach it: where Open Logline goes. Any answer at
// all is an answer; only a refusal, a drop or no answer in time is not. Before this, Logline's
// viewer could be down for hours with nothing said. Its endpoint is not asked from here: it is
// the machines' way in, a name serviceman itself may not resolve; what the machines hear back
// says whether it takes lines (health_from_views).
//
//     logline   the config's, null when nobody's lines go anywhere
//     out       [[key, {state, text, detail}]], as health_from_views reads `seen`
async function health_of_logline(logline)
{
    if (logline === null) {
        return [];
    }
    if ((logline.ui === null) || (logline.ui === undefined)) {
        return [];
    }
    return [await ask('logline:ui', logline.ui, 'Open Logline')];
}

async function ask(key, url, what)
{
    const begin = Date.now();
    try {
        await fetch(url, {method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS)});
        return [key, {state: 'ok', text: `answers in ${Date.now() - begin} ms`, detail: url}];
    }
    catch (error) {
        const cause = (error.cause === undefined) ? error.message : (error.cause.code || error.cause.message);
        return [key, {state: 'bad', text: 'does not answer', detail: `${url}: ${cause}. ${what} go nowhere: see that Logline runs there.`, cause: `nothing answers at ${url}: ${cause}`}];
    }
}

module.exports = health_of_logline;
