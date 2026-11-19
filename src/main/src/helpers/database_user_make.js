const crypto = require('crypto');

// A database's own user: named after it in small letters, digits and _, and a password of 24
// hex digits, 96 bits, which no SQL needs to quote
function database_user_make(database)
{
    const user = database.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
    return {user, password: crypto.randomBytes(12).toString('hex')};
}

module.exports = database_user_make;
