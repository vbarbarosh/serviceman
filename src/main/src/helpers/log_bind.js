const log_scope = require('./log_scope');

// An event listener runs in the context of whatever fired it, not of whatever registered it,
// so a line written from one would land outside its group. This keeps it inside.
function log_bind(fn)
{
    const group = log_scope.getStore();
    return function () {
        const args = arguments;
        const self = this;
        return log_scope.run(group, () => fn.apply(self, args));
    };
}

module.exports = log_bind;
