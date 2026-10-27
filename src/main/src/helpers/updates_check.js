// apt's package lists older than this make "up to date" a guess: the root half fetches them
// every six hours, so lists this old are a machine's with no root half, or one whose fetch fails
const LISTS_OLD_MS = 2*24*3600*1000;
const DAY_MS = 24*3600*1000;

// What a machine's updates come to, as its agent counts them: a restart an upgrade waits for,
// security updates waiting, the rest waiting, or nothing. Said the same on Health and on the
// Security page. Nothing waiting, counted from lists days old, is not said to be up to date.
//
//     updates   {pending, security, held, reboot, lists_at}, as the agent says them, or null
//     now       ms, for the lists' age
//     out       {key, label, state, text, detail}, or null when the agent says nothing
function updates_check(updates, now)
{
    if ((updates === null) || (updates === undefined)) {
        return null;
    }
    const old = lists_old_line(updates.lists_at, now);
    if (updates.reboot) {
        return check('warn', 'restart wanted', ['An upgrade is in place and waits for the machine to restart.', old]);
    }
    if (updates.security > 0) {
        const many = (updates.security === 1) ? 'update' : 'updates';
        return check('warn', `${updates.security} security`, [`${updates.security} security ${many} of ${updates.pending} pending: Configure, Upgrade.`, old]);
    }
    if (updates.pending > 0) {
        return check('ok', `${updates.pending} pending`, [old]);
    }
    if (old !== null) {
        return check('none', `lists ${days_of(now - updates.lists_at)} old`, [old]);
    }
    return check('ok', 'up to date', []);
}

// Said where apt's lists are old: what the count misses, and what fetches them
function lists_old_line(lists_at, now)
{
    if ((typeof lists_at !== 'number') || (now - lists_at < LISTS_OLD_MS)) {
        return null;
    }
    return `apt last fetched its package lists ${days_of(now - lists_at)} ago, so an update published since is not counted. The root half fetches them every 6 hours where the machine has one (its log says why a fetch failed); Install fetches them first.`;
}

function days_of(ms)
{
    const days = Math.floor(ms/DAY_MS);
    return `${days} ${(days === 1) ? 'day' : 'days'}`;
}

function check(state, text, lines)
{
    const said = lines.filter(v => v !== null);
    return {key: 'updates', label: 'Updates', state, text, detail: (said.length === 0) ? null : said.join('\n')};
}

module.exports = updates_check;
