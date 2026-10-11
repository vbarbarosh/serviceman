// The last thing a command said. Everything it said is already in the log, line by line, so a
// line that ends the work names the reason without repeating the rest of it.
function last_line(text)
{
    const lines = String(((text === undefined) || (text === null)) ? '' : text).split('\n').filter(v => v.trim() !== '');
    return ((lines.length === 0) ? 'it said nothing' : lines[lines.length - 1]);
}

module.exports = last_line;
