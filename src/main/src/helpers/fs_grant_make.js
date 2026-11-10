const crypto = require('crypto');

// A grant to read one folder of one machine, or one file of it, under the machine's own file
// address (<name>.fs.<control host>), until a time: {remote, path, kind, until}, kind `folder`
// or `file`, as text an address or a cookie can hold. It is serviceman's own word: signed with
// a key made when the process started, it holds for this serviceman alone and ends with it.
function fs_grant_make(app, grant)
{
    const body = Buffer.from(JSON.stringify({remote: grant.remote, path: grant.path, kind: grant.kind, until: grant.until})).toString('base64url');
    return `${body}.${crypto.createHmac('sha256', app.fs_grant_key).update(body).digest('base64url')}`;
}

module.exports = fs_grant_make;
