// A stand-in for ufw, for an agent under test to run instead of the machine's own (SERVICEMAN_UFW):
// it keeps its rules in the file FAKE_UFW_STATE names, a rule a line as `ufw show added` lists it,
// and answers status (active), show added, allow and delete the way ufw does. Nothing on the
// machine is touched.
const fs = require('fs');

const file = process.env.FAKE_UFW_STATE;
const argv = process.argv.slice(2);
const rules = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(v => v !== '') : [];

function line_of(words)
{
    const at = words.indexOf('comment');
    if (at === -1) {
        return `ufw ${words.join(' ')}`;
    }
    return `ufw ${words.slice(0, at + 1).join(' ')} '${words[at + 1]}'`;
}

if (argv[0] === 'status') {
    process.stdout.write('Status: active\n');
}
else if ((argv[0] === 'show') && (argv[1] === 'added')) {
    process.stdout.write(['Added user rules (see \'ufw status\' for running firewall):'].concat(rules).join('\n') + '\n');
}
else if (argv[0] === 'allow') {
    rules.push(line_of(argv));
    fs.writeFileSync(file, rules.join('\n') + '\n');
    process.stdout.write('Rule added\n');
}
else if (argv[0] === 'delete') {
    const wanted = line_of(argv.slice(1));
    const left = rules.filter(v => v !== wanted);
    if (left.length === rules.length) {
        process.stderr.write(`Could not delete non-existent rule\n`);
        process.exit(1);
    }
    fs.writeFileSync(file, left.join('\n') + (left.length ? '\n' : ''));
    process.stdout.write('Rule deleted\n');
}
else {
    process.stderr.write(`fake ufw: ${argv.join(' ')} is not something it answers\n`);
    process.exit(1);
}
