const TRIES = 5;
const WAIT_MS = 600;

// A save whose answer never came back says nothing about whether it landed: serviceman may have
// been restarted between the write and the reply — by a watcher, by a person, by the machine.
// So the page does not guess. It asks again, a few times, and looks for what it asked for.
async function settled(check)
{
    for (let i = 0; i < TRIES; i++) {
        await new Promise(v => setTimeout(v, WAIT_MS));
        try {
            if (await check()) {
                return true;
            }
        }
        catch {
            // Still not answering; ask again until the tries run out
        }
    }
    return false;
}

export default settled;
