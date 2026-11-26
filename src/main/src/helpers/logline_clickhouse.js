const http = require('http');
const logline_remote = require('./logline_remote');
const tunnel_open = require('./tunnel_open');

// Where ClickHouse listens on Logline's machine, as Logline's compose file publishes it: that
// machine's loopback alone (SERVICEMAN_LOGLINE_CLICKHOUSE_PORT, for a test that cannot take 8123)
const HOST = '127.0.0.1';
const PORT = 8123;
// The user Logline's own viewer asks with (logline/config/clickhouse.xml): no password, SELECT
// on the lines and the sizes of the tables alone, readonly, 30 seconds and 4 threads a query, and
// a query stopped once whoever asked it lets go of its connection
const USER = 'log_ui';
// What the address may carry: the query's parameters and the format of the answer. A user, a
// password, a role, a session, a quota key or a setting is never the asker's to pick.
const RE_PARAM = /^param_[A-Za-z0-9_]{1,64}$/;
const FORMAT = 'default_format';
// How long an answer may stand still, as nginx's proxy_read_timeout in front of Logline's viewer
const IDLE_MS = 60000;

// One query sent to ClickHouse on Logline's machine, through the link its agent dialled, as
// Logline's own viewer sends it through its nginx: as the read-only user, with nothing of the
// asker's but the query, its parameters and the format. ClickHouse is reached on that
// machine's loopback; nothing on it is published for this.
//
//     search   URLSearchParams: param_<name> and default_format, nothing else
//     sql      Buffer, the query
//     signal   AbortSignal or undefined: aborted, the connection to ClickHouse goes, and
//              ClickHouse stops the query
//     out      the answer as it comes, an http.IncomingMessage, its status ClickHouse's own
//
// What keeps the query from ClickHouse is thrown in words, with the status to answer it with:
// 400 for an address that carries anything else, 503 while Logline's machine is not found or
// not connected, 502 when ClickHouse does not answer there, 504 when it stops answering.
function logline_clickhouse(app, search, sql, signal)
{
    for (const name of search.keys()) {
        if ((name !== FORMAT) && (RE_PARAM.test(name) === false)) {
            return Promise.reject(status_error(400, `Logline's ClickHouse is asked with the query's parameters (param_<name>) and ${FORMAT} alone, not ${JSON.stringify(name.slice(0, 64))}`));
        }
    }
    let remote;
    let socket;
    const port = port_of();
    try {
        remote = logline_remote(app);
        socket = tunnel_open(remote, {host: HOST, port});
    }
    catch (error) {
        return Promise.reject(status_error(503, error.message));
    }
    return new Promise(function (resolve, reject) {
        const request = http.request({
            method: 'POST',
            host: HOST,
            port,
            path: `/?${search.toString()}`,
            headers: {'content-type': 'text/plain; charset=utf-8', 'content-length': sql.length, 'x-clickhouse-user': USER, 'connection': 'close'},
            createConnection: () => socket,
            signal,
        }, resolve);
        request.setTimeout(IDLE_MS, function () {
            request.destroy(status_error(504, `ClickHouse on ${remote.name} said nothing for ${IDLE_MS/1000}s`));
        });
        request.on('error', function (error) {
            reject(error_from_failure(error, remote, port));
        });
        request.end(sql);
    });
}

// SERVICEMAN_LOGLINE_CLICKHOUSE_PORT, or the port Logline's compose file publishes
function port_of()
{
    const given = process.env.SERVICEMAN_LOGLINE_CLICKHOUSE_PORT;
    return (given === undefined) ? PORT : parseInt(given, 10);
}

// A failure of the way to ClickHouse, in words: nothing listening there is Logline not running
function error_from_failure(error, remote, port)
{
    if (typeof error.status === 'number') {
        return error;
    }
    if (error.name === 'AbortError') {
        return error;
    }
    if (error.code === 'ECONNREFUSED') {
        return status_error(502, `ClickHouse does not answer on ${remote.name}: nothing listens on ${HOST}:${port} there, so Logline is not running or not started yet`);
    }
    return status_error(502, `ClickHouse on ${remote.name} did not answer: ${error.message}`);
}

function status_error(status, message)
{
    const out = new Error(message);
    out.status = status;
    return out;
}

module.exports = logline_clickhouse;
