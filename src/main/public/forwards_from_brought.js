import brought_said from './brought_said.js';

// The forwards a program's card "Its port on another machine" writes, in the config file's
// shape: one for each machine its port is brought to, from the one machine it runs on, then the
// ones kept as written. An empty box is what it says it stands for (brought_said). A forward that
// comes back as it was read is the file's own, `off` and anything written by hand with it; a new
// one, or one brought to another machine now, is labelled after the program and the machine,
// `llm → laptop` (`llm → this host` for serviceman's own), a number added when the label is taken.
//
//     program  {name, machine, port, remotes, tried} as brought_said takes it, and `labels`, the
//              labels of every forward of the config that is not part of it
function forwards_from_brought(brought, program)
{
    const said = brought_said(brought, program);
    // A label a forward keeps is taken before any new one is made
    const labels = program.labels.concat(brought.targets.filter(v => label_kept(v)).map(v => v.original.label), brought.kept.map(v => v.label));
    const out = [];
    for (let i = 0, end = brought.targets.length; i < end; ++i) {
        const target = brought.targets[i];
        const original = target.original;
        const value = said.targets[i].value;
        // This host, where serviceman runs, is `here`: it listens itself
        const place = (target.remote === null) ? {here: true} : {remote: target.remote};
        const to = Object.assign(place, (target.kind === 'socket') ? {socket: value} : {port: number_or_text(value)});
        const label = label_kept(target) ? original.label : label_free(`${program.name} → ${(target.remote === null) ? 'this host' : target.remote}`, labels);
        labels.push(label);
        const forward = {label, service: program.name, from: {remote: program.machine, port: number_or_text(said.port.value)}, to};
        if ((original !== null) && (original.off === true)) {
            forward.off = true;
        }
        out.push(((original !== null) && is_same(forward, original)) ? original : forward);
    }
    for (const forward of brought.kept) {
        out.push(forward);
    }
    return out;
}

// A forward still brought to the machine it was keeps its label: the page, its counts and its
// logs know it by that
function label_kept(target)
{
    if (target.original === null) {
        return false;
    }
    return (target.original.to.here === true) ? (target.remote === null) : (target.original.to.remote === target.remote);
}

// The first of label, label 2, label 3… that no other forward has
function label_free(label, labels)
{
    if (labels.includes(label) === false) {
        return label;
    }
    for (let i = 2; ; i++) {
        if (labels.includes(`${label} ${i}`) === false) {
            return `${label} ${i}`;
        }
    }
}

// Whether the forward written is the one read, whatever order its keys were written in: what
// serviceman writes into it alone, the token that asked for it, is not the form's to compare
function is_same(forward, original)
{
    return json_sorted(forward) === json_sorted(Object.assign({}, original, {by: undefined}));
}

function json_sorted(value)
{
    return JSON.stringify(value, function (key, v) {
        if ((v === null) || (typeof v !== 'object') || Array.isArray(v)) {
            return v;
        }
        return Object.fromEntries(Object.keys(v).sort().map(vv => [vv, v[vv]]));
    });
}

// A number lands as a number; anything else stays as typed for the config to name
function number_or_text(text)
{
    return /^\d+$/.test(text) ? parseInt(text, 10) : text;
}

export default forwards_from_brought;
