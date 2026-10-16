const remote_call = require('./remote_call');
const remote_can = require('./remote_can');

const TIMEOUT_MS = 20000;

// Whether one machine's firewall is on, from one `ufw status`: on with its rules counted, off,
// not there, or not to be asked (an agent from before the firewall, a sudo that wants a
// password). Off is said, not counted as broken: a laptop behind a router may want it so.
//
//     out   {state, text, detail}, as health_from_views reads `seen`
async function health_of_firewall(app, remote)
{
    if (remote_can(remote, 'ufw') === false) {
        return {state: 'none', text: 'not asked', detail: 'Its agent is from before the firewall.'};
    }
    let answer;
    try {
        answer = await remote_call(app, remote, 'ufw', {argv: ['status']}, TIMEOUT_MS);
    }
    catch (error) {
        return {state: 'none', text: 'not asked', detail: error.message};
    }
    const text = `${answer.stderr}\n${answer.stdout}`.trim();
    if ((answer.ok === false) && /not found|No such file/.test(answer.stderr)) {
        return {state: 'none', text: 'no ufw', detail: 'ufw is not installed there.'};
    }
    if (answer.ok === false) {
        const why = (/sudo:.*(password|no tty|askpass)/.test(text) ? 'ufw needs root, and sudo there asks for a password: give it a root agent.' : (text.split('\n').pop() || `ufw ended with ${answer.code}`));
        return {state: 'none', text: 'cannot ask', detail: why};
    }
    if (/^Status: active/m.test(answer.stdout) === false) {
        return {state: 'warn', text: 'off', detail: 'ufw is installed and off: every port the machine listens on is open to whoever reaches it.'};
    }
    const rules = rules_count(answer.stdout);
    return {state: 'ok', text: `on, ${rules} ${(rules === 1) ? 'rule' : 'rules'}`, detail: null};
}

// The lines under the dashes of `ufw status`, one a rule
function rules_count(stdout)
{
    const lines = stdout.split('\n');
    const head = lines.findIndex(v => /^-+\s+-+/.test(v));
    return ((head < 0) ? 0 : lines.slice(head + 1).filter(v => v.trim() !== '').length);
}

module.exports = health_of_firewall;
