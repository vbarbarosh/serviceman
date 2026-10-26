const crypto = require('crypto');

// The secrets of a new home, made here and kept here: the machines are given what they need,
// the page never sees one. Letters and digits only, so none needs quoting in a config file.
//
//   redis_password  what Redis asks of every machine
//   rpc_secret      Garage's own, 32 bytes as it wants them
//   access_key      the bucket's key, in Garage's own form: GK and 12 bytes
//   secret_key      and its secret
//   passphrase      what locks the volume's private key, kept in Redis
function shared_secrets_make()
{
    return {
        redis_password: crypto.randomBytes(24).toString('hex'),
        rpc_secret: crypto.randomBytes(32).toString('hex'),
        access_key: `GK${crypto.randomBytes(12).toString('hex')}`,
        secret_key: crypto.randomBytes(32).toString('hex'),
        passphrase: crypto.randomBytes(24).toString('hex'),
    };
}

module.exports = shared_secrets_make;
