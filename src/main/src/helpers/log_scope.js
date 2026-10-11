const async_hooks = require('async_hooks');

// The group a line belongs to, carried along the work itself: everything a request causes —
// starting a container, waiting for a port, the answer — is written under the request's own
// group without every function having to pass it on.
const log_scope = new async_hooks.AsyncLocalStorage();

module.exports = log_scope;
