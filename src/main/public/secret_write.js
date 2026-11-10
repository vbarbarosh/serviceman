// One question to the secrets door: a secret written down, copied from the library or, its
// value empty, taken away. Answers with what the door keeps now, {global, services}, or with
// {error}: the door's own words for what it refuses, and a request with no answer said as one.
// It never throws, so no caller takes a refusal for a secret kept.
async function secret_write(body)
{
    try {
        const answer = await fetch('/api/v1/secrets', {method: 'POST', body: JSON.stringify(body)});
        const said = await answer.json().catch(() => ({}));
        if (answer.ok && Array.isArray(said.global) && Array.isArray(said.services)) {
            return said;
        }
        return {error: said.error || `the answer was ${answer.status}, with nothing of the door's to read`};
    }
    catch {
        return {error: 'the answer never came back'};
    }
}

export default secret_write;
