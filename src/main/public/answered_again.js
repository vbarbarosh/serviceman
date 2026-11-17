const EVERY_MS = 1000;
// A restart of serviceman's container takes seconds; one under an upgrade of the Docker it runs
// on, a minute or two
const LIMIT_MS = 180000;

// What serviceman answers once it answers again. A request whose answer never came back says
// nothing of whether it landed: serviceman was away when it was sent, or went away under it. So
// `read`, which throws while serviceman is away, is asked once a second until it answers, and
// what it answered is the answer here, for the page to say what came of the request. Null when
// serviceman is still away after three minutes, or `gone()` says the part of the page that asked
// has closed meanwhile.
async function answered_again(read, gone)
{
    const until = Date.now() + LIMIT_MS;
    while (Date.now() < until) {
        try {
            return await read();
        }
        catch {
            // Still away: asked again in a second
        }
        await new Promise(v => setTimeout(v, EVERY_MS));
        if (gone()) {
            return null;
        }
    }
    return null;
}

export default answered_again;
