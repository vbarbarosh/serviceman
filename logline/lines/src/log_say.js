const log_words = require('./log_words');

// What became of stdout: whether an error there is listened for yet, and whether one came
const STDOUT = {heard: false, gone: false};

// One line on stdout, `[group_uid][sender] details`. No time: docker stamps every line itself.
//
// Under docker stdout always takes its lines. Under a pipe the reader may go, and the line after
// that comes back as an error on the stream: with nobody listening it ended the process.
// Listened for, it is the last line tried there.
function log_say(uid, sender, words)
{
    const said = (typeof words === 'string') ? words : log_words(words || {});
    if (STDOUT.heard === false) {
        STDOUT.heard = true;
        process.stdout.on('error', function () {
            STDOUT.gone = true;
        });
    }
    if (STDOUT.gone === false) {
        console.log(`[${uid}][${sender}]${(said === '') ? '' : ` ${said}`}`);
    }
}

module.exports = log_say;
