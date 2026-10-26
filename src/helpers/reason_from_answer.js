// Errors and refusals the way commands start them: apt's E:, docker's Error response, ufw's ERROR
const RE_ERROR = /^(E:|ERROR\b|Error\b|error\b|fatal\b|FATAL\b)/;

// Why a command failed, in one line, from what it printed: {stderr, stdout}. A command says why
// on stderr; what came last on stdout is only where it stopped, however late it came: apt-get's
// last line there is "Reading package lists...", its reason an E: line on stderr, and maybe a W:
// after it. So the last error line of stderr, else its last line, else stdout's last line; null
// for a command that said nothing.
function reason_from_answer(answer)
{
    const errors = lines_of(answer.stderr);
    const flagged = errors.filter(v => RE_ERROR.test(v.trim()));
    if (flagged.length > 0) {
        return flagged[flagged.length - 1].trim();
    }
    if (errors.length > 0) {
        return errors[errors.length - 1].trim();
    }
    const said = lines_of(answer.stdout);
    return (said.length === 0) ? null : said[said.length - 1].trim();
}

function lines_of(text)
{
    return String(((text === undefined) || (text === null)) ? '' : text).split('\n').filter(v => v.trim() !== '');
}

module.exports = reason_from_answer;
