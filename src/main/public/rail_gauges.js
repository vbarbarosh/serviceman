import machine_shares from './machine_shares.js';
import remote_unanswered_said from './remote_unanswered_said.js';
import share_level from './share_level.js';

// The numbers a machine's Overview can tick for the rail, in the order they stand there
const NUMBERS = [
    {key: 'cpu', label: 'CPU'},
    {key: 'memory', label: 'Memory'},
    {key: 'disk', label: 'Disk'},
];

// A machine's row in the rail: a small bar for each number ticked, filled from its foot, and
// the numbers in words for its title. null when none is ticked, or while the machine is not
// linked: its dot is red, and what it said last is old.
function rail_gauges(remote, keys)
{
    if ((keys.length === 0) || (remote.phase !== 'online') || (remote.machine === null)) {
        return null;
    }
    const shares = machine_shares(remote.machine);
    const gauges = [];
    const words = [];
    for (const number of NUMBERS) {
        if (keys.includes(number.key) === false) {
            continue;
        }
        const share = shares[number.key];
        if (share === null) {
            gauges.push({key: number.key, level: 'none', height: '0%'});
            words.push(`${number.label} not measured`);
            continue;
        }
        // Never quite empty, so an idle machine's bar is told from one with no number
        const percent = Math.round(Math.min(1, Math.max(0, share))*100);
        gauges.push({key: number.key, level: share_level(share), height: `${Math.max(8, percent)}%`});
        words.push(`${number.label} ${percent}%`);
    }
    const said = remote_unanswered_said(remote);
    const title = (said === '') ? words.join(' · ') : `${words.join(' · ')}, as it said last. ${said}`;
    return {gauges, stale: (said !== ''), title};
}

export default rail_gauges;
