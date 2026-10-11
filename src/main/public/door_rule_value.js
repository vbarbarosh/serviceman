// A door rule as the config holds it: the service alone where that is the whole of it, so a
// file written by hand stays one line a rule, and an object where there is more to say
function door_rule_value(service, off, auth)
{
    if ((off === false) && ((auth === '') || (auth === null))) {
        return service;
    }
    const out = {service};
    if (off) {
        out.off = true;
    }
    if ((auth !== '') && (auth !== null)) {
        out.auth = auth;
    }
    return out;
}

export default door_rule_value;
