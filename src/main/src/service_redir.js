const program_mark = require('./helpers/program_mark');

const PREFIX = '/redir/';

// An address of serviceman's own that belongs to one service. It is on whatever hostname
// serviceman was asked on — `localhost` above all, because that is the one name Google, and
// everybody else with rules about redirect URLs, accepts over plain http.
//
// A visitor sent here is sent on to the service's own address, keeping the rest of the path and
// the whole query. That is what an OAuth callback needs: the code arrives at a name the rules
// allow, and the browser finishes at the name the app's session belongs to.
function service_redir(service)
{
    return `${PREFIX}${program_mark(service.name).slice(0, 8)}`;
}

service_redir.prefix = PREFIX;

module.exports = service_redir;
