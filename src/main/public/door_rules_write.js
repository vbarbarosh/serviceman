// The names one machine's door answers, changed and written back. The whole entry is read and
// written back, so a token or a tag the caller knows nothing about goes back exactly as it was.
// Answers with null, or with what went wrong.
async function door_rules_write(name, change)
{
    try {
        const loaded = await fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
        const found = (JSON.parse(loaded.text).remotes || []).find(v => v.name === name);
        if (found === undefined) {
            return `no machine named ${name} is in the config`;
        }
        const inbound = Object.assign({}, found.inbound);
        change(inbound);
        const remote = Object.assign({}, found, {inbound});
        if (Object.keys(inbound).length === 0) {
            delete remote.inbound;
        }
        const answer = await fetch(`/api/v1/remotes/${encodeURIComponent(name)}`, {method: 'PUT', body: JSON.stringify({remote})});
        if (answer.ok === false) {
            return (await answer.json()).error;
        }
        return null;
    }
    catch {
        return 'the answer never came back';
    }
}

export default door_rules_write;
