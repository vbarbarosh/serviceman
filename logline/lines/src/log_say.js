const log_words = require('./log_words');

// One line on stdout, `[group_uid][sender] details`. No time: docker stamps every line itself.
function log_say(uid, sender, words)
{
    const said = (typeof words === 'string') ? words : log_words(words || {});
    console.log(`[${uid}][${sender}]${(said === '') ? '' : ` ${said}`}`);
}

module.exports = log_say;
