// What the bar says when the names asked to be renamed or moved did not all go: how many went,
// how many stay where they were, and why, in the disk's own words. One name asked for alone is
// the disk's words alone.
//
//     word     what going is called: renamed, moved
//     total    how many names were asked for
//     done     how many of them went
//     taken    what the disk said of each name that is taken where it was to go
//     stopped  what the disk said that stopped the rest, '' when nothing did
function rename_said(word, total, done, taken, stopped)
{
    const why = [];
    if (taken.length > 0) {
        const more = taken.length - 1;
        why.push((more === 0) ? taken[0] : `${taken[0]}, and so ${(more === 1) ? 'is' : 'are'} ${more} more`);
    }
    if (stopped !== '') {
        why.push(stopped);
    }
    if (total === 1) {
        return why.join('; ');
    }
    const stay = total - done;
    const counts = (done === 0) ? `none of ${total} ${word}` : `${done} of ${total} ${word}, ${stay} ${(stay === 1) ? 'stays' : 'stay'} here`;
    return `${counts} — ${why.join('; ')}`;
}

export default rename_said;
