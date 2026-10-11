// What serviceman says it is doing right now
function state_read()
{
    return fetch('/api/v1/status', {cache: 'no-store'}).then(v => v.json());
}

export default state_read;
