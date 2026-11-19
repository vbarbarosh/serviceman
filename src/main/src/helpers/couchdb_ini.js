// The settings serviceman lays into a CouchDB's local.d before it starts: it trusts the user
// name a proxy in front of it sends, X-Forwarded-User, only with X-Forwarded-User-Token, that
// name's HMAC by the shared secret (sha256, then sha1); and it is one node, so its own databases
// (_users, _replicator) are made as it first comes up. The secret is serviceman's, made for
// this server and kept in data/databases.json; the file stays inside the container.
function couchdb_ini(secret)
{
    return `[chttpd]
authentication_handlers = proxy, cookie, default

[chttpd_auth]
proxy_use_secret = true
secret = ${secret}
x_auth_username = X-Forwarded-User
x_auth_token = X-Forwarded-User-Token
hash_algorithms = sha256, sha

[couchdb]
single_node = true
`;
}

module.exports = couchdb_ini;
