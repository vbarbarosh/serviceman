// What that machine's door does with this name: the service that answers it and whether it is
// answering at all, or null for a name the door was never given. The rules are on the machine's
// own entry in the config and its boards, written on this host (board_rules.with_inbound) — a
// door stands on a public address, and the machine behind it is the one thing this host cannot
// take on trust.
//
// The name is not the service's own address. A service keeps whatever it publishes, and a door
// says which service takes the name it carries in, so nothing has to be renamed to be served
// from another machine's front.
function inbound_rule(rules, host)
{
    const named = rules[host];
    if (named !== undefined) {
        return named;
    }
    for (const pattern of Object.keys(rules)) {
        // `*.example.com` is every name under it, and not the bare name itself — the same
        // reading a service's own publish gives it
        if (pattern.startsWith('*.') && (host.length > pattern.length - 1) && host.endsWith(pattern.slice(1))) {
            return rules[pattern];
        }
    }
    return null;
}

module.exports = inbound_rule;
