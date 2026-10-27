const net = require('net');

const TIMEOUT_MS = 3000;

// Whether a port of a machine answers from here, the way anyone out there would try it: a
// connection made and dropped at once, nothing sent. Answered is open to whoever is where this
// serviceman is; refused is a machine that says no (nothing listens on that address, or a rule
// rejects); silent is a knock dropped on the way, by the machine's firewall or one in front of
// it; unreachable is no way from here to that address at all (an IPv6 one from a host without).
//
//     out   'answered' | 'refused' | 'silent' | 'unreachable'
function security_knock(address, port, timeout_ms)
{
    return new Promise(function (resolve) {
        const socket = net.connect({host: address, port});
        let done = false;
        function end(result) {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(result);
        }
        const timer = setTimeout(() => end('silent'), (timeout_ms === undefined) ? TIMEOUT_MS : timeout_ms);
        socket.once('connect', () => end('answered'));
        socket.once('error', function (error) {
            end((error.code === 'ECONNREFUSED') ? 'refused' : (['ETIMEDOUT'].includes(error.code) ? 'silent' : 'unreachable'));
        });
    });
}

module.exports = security_knock;
