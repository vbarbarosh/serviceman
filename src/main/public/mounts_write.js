// The mounts, changed and written back whole. The list is read from the config file rather than
// from the status, so a mount written by hand goes back exactly as it was written. Answers with
// null, or with what went wrong.
async function mounts_write(change)
{
    try {
        const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
        const mounts = (JSON.parse(loaded.text).mounts || []).slice();
        change(mounts);
        const answer = await fetch('/api/v1/mounts', {method: 'PUT', body: JSON.stringify({mounts})});
        if (answer.ok === false) {
            return (await answer.json()).error;
        }
        return null;
    }
    catch {
        return 'the answer never came back';
    }
}

export default mounts_write;
