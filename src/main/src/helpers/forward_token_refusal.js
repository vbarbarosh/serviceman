// Why a token other than the owner's may not see or write this forward, as the config writes
// it, in words that end "the token … ", or null when it may. A token's forward carries a port or
// a socket between machines it sees, both ends on them: serviceman itself, and an address beyond
// the machine (`host`), are the owner's. An end of no shape at all is left to the config's own
// check, which refuses it.
function forward_token_refusal(item, token)
{
    const ends = ((item === null) || (typeof item !== 'object')) ? [] : [item.from, item.to];
    for (const end of ends) {
        if ((end === null) || (typeof end !== 'object')) {
            continue;
        }
        if (end.here !== undefined) {
            return 'may not open a forward on serviceman itself';
        }
        if (end.host !== undefined) {
            return 'may not reach an address beyond its machines';
        }
        if ((typeof end.remote === 'string') && (token.remotes.includes('*') === false) && (token.remotes.includes(end.remote) === false)) {
            return `may not see ${end.remote}`;
        }
    }
    return null;
}

module.exports = forward_token_refusal;
