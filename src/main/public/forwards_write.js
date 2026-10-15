// The forwards, changed and written back whole. The list is read from the config file rather
// than from the status, so a forward written by hand goes back exactly as it was written.
// Answers with null, or with what went wrong.
async function forwards_write(change)
{
    try {
        const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
        const forwards = (JSON.parse(loaded.text).forwards || []).slice();
        change(forwards);
        const answer = await fetch('/api/v1/forwards', {method: 'PUT', body: JSON.stringify({forwards})});
        if (answer.ok === false) {
            return (await answer.json()).error;
        }
        return null;
    }
    catch {
        return 'the answer never came back';
    }
}

export default forwards_write;
