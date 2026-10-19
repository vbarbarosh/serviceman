const cli = require('@vbarbarosh/node-helpers/src/cli');
const lines_serve = require('./src/lines_serve');
const log_say = require('./src/log_say');
const log_uid = require('./src/log_uid');
const path = require('path');

cli(main);

// Everything it needs comes from the environment, as a container is given it:
//
//   PORT         where it listens, 3000
//   BIND         the address it listens on, every one by default; docker-compose.yml gives the
//                tailnet address alone
//   ADMIN_TOKEN  what serviceman shows to issue and revoke tokens
//   ADMIN_IPS    where serviceman may ask from: addresses and ranges, comma-separated
//                Without both, no token is issued; the ones already issued go on working.
//   CLICKHOUSE   ClickHouse's HTTP door, and who asks: http://lines:@clickstack:8123
//   TABLE        where the lines go, default.otel_logs
//   DATA         where the issued tokens are kept, ./data
async function main()
{
    const env = process.env;
    const admin_ips = (env.ADMIN_IPS || '').split(',').map(v => v.trim()).filter(v => v !== '');
    const uid = log_uid();
    // Without both, nobody may issue a token: the endpoint still takes lines with the tokens
    // it already has, and says why /tokens is shut
    let admin_off = null;
    if ((env.ADMIN_TOKEN || '').length < 32) {
        admin_off = 'ADMIN_TOKEN is not set, or shorter than 32 characters (openssl rand -hex 32)';
    }
    else if (admin_ips.length === 0) {
        admin_off = 'ADMIN_IPS is not set: the addresses serviceman asks for tokens from, such as 100.64.0.5';
    }
    const config = {
        port: parseInt(env.PORT || '3000', 10),
        bind: env.BIND || undefined,
        admin_token: (admin_off === null) ? env.ADMIN_TOKEN : null,
        admin_off,
        admin_ips,
        clickhouse: env.CLICKHOUSE || 'http://lines:@clickstack:8123',
        table: env.TABLE || 'default.otel_logs',
        tokens_file: path.resolve(env.DATA || path.join(__dirname, 'data'), 'tokens.json'),
        uid,
    };
    log_say(uid, 'group_spawn');
    const server = lines_serve(config);
    await new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(config.port, config.bind, resolve);
    });
    log_say(uid, 'lines_begin', {port: config.port, table: config.table, admin_ips: config.admin_ips});
    if (admin_off !== null) {
        log_say(uid, 'lines_admin_off', {reason: admin_off});
    }
    await new Promise(function (resolve) {
        for (const signal of ['SIGINT', 'SIGTERM']) {
            process.once(signal, function () {
                log_say(uid, 'lines_end_ok', {signal});
                server.close(resolve);
                server.closeAllConnections();
            });
        }
    });
}
