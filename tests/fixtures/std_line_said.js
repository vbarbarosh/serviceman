const std_line = require('../../src/helpers/std_line');

// What std_line hands to console.log and console.error, said as JSON at the end: a line to
// each stream; the error a pipe gives stdout once its reader is gone; a line to each again;
// the same error on stderr; one line more. A process of its own, since the errors are put on
// the real streams.
const said = [];
console.log = function (line) {
    said.push(['stdout', line]);
};
console.error = function (line) {
    said.push(['stderr', line]);
};
std_line('stdout', 'one');
std_line('stderr', 'two');
process.stdout.emit('error', new Error('write EPIPE'));
std_line('stdout', 'three');
std_line('stderr', 'four');
process.stderr.emit('error', new Error('write EPIPE'));
std_line('stderr', 'five');
process.stdout.write(JSON.stringify(said));
