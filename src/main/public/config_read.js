// The config file as it is on disk right now, with the hash that says which version it is
function config_read()
{
    return fetch('/api/v1/config', {cache: 'no-store'}).then(v => v.json());
}

export default config_read;
