// The lines of a tail that have not been said yet. The last line said is looked for, and what
// follows it is what is new; a tail that has already scrolled past it is new in full.
function tail_new(lines, last)
{
    if ((last === null) || (last === undefined)) {
        return lines;
    }
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i] === last) {
            return lines.slice(i + 1);
        }
    }
    return lines;
}

module.exports = tail_new;
