import format_ms_ago from './format_ms_ago.js';

// apt's package lists older than this make "up to date" a guess, as Health and the Security
// page say it: the root half fetches them every six hours where a machine has one
const LISTS_OLD_MS = 2*24*3600*1000;
const DAY_MS = 24*3600*1000;

// How old apt's package lists are, which is how old a machine's count of updates is: null where
// its agent does not say (one from before)
//
//     updates   the machine's updates, as its agent says them
//     ->        {old, ago: '3h ago', days: 9}
function updates_lists(updates, now)
{
    if ((updates === null) || (updates === undefined) || (typeof updates.lists_at !== 'number')) {
        return null;
    }
    const age = now - updates.lists_at;
    return {old: (age >= LISTS_OLD_MS), ago: format_ms_ago(age), days: Math.floor(age/DAY_MS)};
}

export default updates_lists;
