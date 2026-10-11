const pool_pump = require('./pool_pump');

// The request is done: the instance gets its stamp and the line moves
function pool_release(app, service, instance)
{
    instance.inflight = Math.max(0, instance.inflight - 1);
    instance.last_activity_at = Date.now();
    pool_pump(app, service);
}

module.exports = pool_release;
