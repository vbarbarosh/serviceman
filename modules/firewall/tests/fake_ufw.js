#!/usr/bin/env node
// ufw as far as the module asks it, saying what ufw 0.36 says, with its rules in the json file
// FAKE_UFW_STATE names: status, show added, a rule added or deleted, enable, disable
const ExitCodeError = require('@vbarbarosh/node-helpers/src/errors/ExitCodeError');
const cli = require('@vbarbarosh/node-helpers/src/cli');
const fs = require('fs');

const file = process.env.FAKE_UFW_STATE;
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {active: false, rules: []};
const argv = process.argv.slice(2);
const words = (argv[0] === '--force') ? argv.slice(1) : argv;

cli(main, report);

function main()
{
    if (words[0] === 'status') {
        if (state.active === false) {
            console.log('Status: inactive');
        }
        else {
            console.log('Status: active\nLogging: on (low)\nDefault: deny (incoming), allow (outgoing), disabled (routed)\nNew profiles: skip\n');
        }
    }
    else if ((words[0] === 'show') && (words[1] === 'added')) {
        console.log('Added user rules (see \'ufw status\' for running firewall):');
        for (const rule of state.rules) {
            console.log(`ufw ${rule.map(v => /\s/.test(v) ? `'${v}'` : v).join(' ')}`);
        }
    }
    else if (words[0] === 'enable') {
        state.active = true;
        console.log('Firewall is active and enabled on system startup');
    }
    else if (words[0] === 'disable') {
        state.active = false;
        console.log('Firewall stopped and disabled on system startup');
    }
    else if (words[0] === 'delete') {
        const rule = words.slice(1).filter((v, i, all) => (all[i - 1] !== 'comment') && (v !== 'comment'));
        const at = state.rules.findIndex(v => same(v, rule));
        if (at === -1) {
            console.log('Could not delete non-existent rule\nCould not delete non-existent rule (v6)');
        }
        else {
            state.rules.splice(at, 1);
            console.log('Rules updated\nRules updated (v6)');
        }
    }
    else if (words[0] === 'insert') {
        // Past the last rule ufw says it inserted, and adds nothing
        const at = Number(words[1]);
        if (at <= state.rules.length) {
            state.rules.splice(at - 1, 0, words.slice(2));
        }
        console.log('Rule inserted\nRule inserted (v6)');
    }
    else if (['allow', 'deny', 'reject', 'limit'].includes(words[0])) {
        const ports = words.join(' ').match(/\d+/g) || [];
        if (ports.some(v => (Number(v) > 65535) && (v.length <= 5))) {
            console.log('ERROR: Bad port');
            throw new ExitCodeError(1);
        }
        const at = state.rules.findIndex(v => same(v, words));
        if (at !== -1) {
            console.log('Skipping adding existing rule\nSkipping adding existing rule (v6)');
        }
        else {
            // The same port and source under another action is that rule changed, as ufw does it
            const other = state.rules.findIndex(v => same(v.slice(1), words.slice(1)));
            if (other === -1) {
                state.rules.push(words);
            }
            else {
                state.rules[other] = words;
            }
            console.log('Rules updated\nRules updated (v6)');
        }
    }
    else {
        throw new ExitCodeError(1, `ERROR: Invalid syntax: ${argv.join(' ')}`);
    }
    fs.writeFileSync(file, JSON.stringify(state));
}

function report(error)
{
    if (!(error instanceof ExitCodeError)) {
        console.error(error);
        return;
    }
    if (error.message) {
        console.error(error.message);
    }
}

// Two rules are one when they say the same without their comments
function same(a, b)
{
    return bare(a) === bare(b);
}

function bare(words)
{
    return words.filter((v, i, all) => (v !== 'comment') && (all[i - 1] !== 'comment')).join(' ');
}
