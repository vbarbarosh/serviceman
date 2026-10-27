// What a machine's updates come to, as its agent counts them: a restart an upgrade waits for,
// security updates waiting, the rest waiting, or nothing. Said the same on Health and on the
// Security page.
//
//     updates   {pending, security, held, reboot}, as the agent says them, or null
//     out       {key, label, state, text, detail}, or null when the agent says nothing
function updates_check(updates)
{
    if ((updates === null) || (updates === undefined)) {
        return null;
    }
    if (updates.reboot) {
        return {key: 'updates', label: 'Updates', state: 'warn', text: 'restart wanted', detail: 'An upgrade is in place and waits for the machine to restart.'};
    }
    if (updates.security > 0) {
        const many = (updates.security === 1) ? 'update' : 'updates';
        return {key: 'updates', label: 'Updates', state: 'warn', text: `${updates.security} security`, detail: `${updates.security} security ${many} of ${updates.pending} pending: Configure, Upgrade.`};
    }
    if (updates.pending > 0) {
        return {key: 'updates', label: 'Updates', state: 'ok', text: `${updates.pending} pending`, detail: null};
    }
    return {key: 'updates', label: 'Updates', state: 'ok', text: 'up to date', detail: null};
}

module.exports = updates_check;
