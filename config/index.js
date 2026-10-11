// How this serviceman instance runs: the doors it listens on, and the
// defaults every service starts from. The services and remotes themselves are
// state, not config — they live in the serviceman.json this instance was
// started with.
module.exports = {
    listen: {
        host: '127.0.0.1',
        port: 3000,
    },
    control: {
        host: 'serviceman.localhost',
        port: 3001,
        socket: './data/serviceman.sock',
    },
    defaults: {
        stop_after_idle: '10m',
    },
};
