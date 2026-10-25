// A word of a route, decoded as the address encoded it. One that is not valid percent-encoding
// (`%zz`) is taken as it stands: it names nothing, and the route says so, where throwing would
// make it a 500 with the exception in it
function route_param(text)
{
    try {
        return decodeURIComponent(text);
    }
    catch {
        return String(text);
    }
}

module.exports = route_param;
