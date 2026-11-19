// What changed between a command's lines as saved and as its card edits them now, a line at a
// time: each line of `after` marked, and the changes as the card's foot says them. Lines are
// matched as they are first; a line left over is paired with one of the same option, or the
// program with the program, and is changed rather than new.
//
//     before    ['./llama-server', '  --ctx-size 65536', '  --jinja']
//     after     ['./llama-server', '  --ctx-size 262144', '  --temp 1.0']
//
//     {marks: [{kind: 'same', was: ''}, {kind: 'changed', was: '65536'}, {kind: 'new', was: ''}],
//      changes: [{kind: 'changed', text: '--ctx-size 65536 → 262144'},
//                {kind: 'new', text: '+ --temp 1.0'}, {kind: 'gone', text: '− --jinja'}]}
//
// An empty line is marked with the kind '' and is no change.
function service_command_diff(before, after)
{
    const old = before.map(v => v.trim()).filter(v => v !== '');
    const now = after.map(v => v.trim());
    const kept = [];
    for (const [i, line] of now.entries()) {
        if (line !== '') {
            kept.push(i);
        }
    }
    const pairs = common_lines(old, kept.map(v => now[v]));
    const old_paired = new Set(pairs.map(v => v[0]));
    const now_paired = new Map(pairs.map(v => [kept[v[1]], v[0]]));
    const marks = now.map(v => ({kind: (v === '') ? '' : 'same', was: ''}));
    const changes = [];
    for (const [k, i] of kept.entries()) {
        if (now_paired.has(i)) {
            continue;
        }
        const key = key_of(now[i], k === 0);
        const j = old.findIndex((v, jj) => (old_paired.has(jj) === false) && (key_of(v, jj === 0) === key));
        if (j === -1) {
            marks[i] = {kind: 'new', was: ''};
            changes.push({kind: 'new', text: `+ ${now[i]}`});
            continue;
        }
        old_paired.add(j);
        const was = rest_of(old[j], key);
        const is = rest_of(now[i], key);
        const whole = ((key === '') || (was === '') || (is === ''));
        marks[i] = {kind: 'changed', was: whole ? old[j] : was};
        changes.push({kind: 'changed', text: whole ? `${old[j]} → ${now[i]}` : `${key} ${was} → ${is}`});
    }
    for (const [j, line] of old.entries()) {
        if (old_paired.has(j) === false) {
            changes.push({kind: 'gone', text: `− ${line}`});
        }
    }
    return {marks, changes};
}

// What pairs two versions of a line: its option, or being the program; '' for the program, whose
// change is said whole
function key_of(line, first)
{
    if (first) {
        return '';
    }
    return line.split(/\s+/)[0];
}

function rest_of(line, key)
{
    return (key === '') ? line : line.slice(key.length).trim();
}

// The longest run of lines both have, in order: pairs of [index in a, index in b]
function common_lines(a, b)
{
    const size = [];
    for (let i = 0; i <= a.length; i++) {
        size.push(new Array(b.length + 1).fill(0));
    }
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            size[i][j] = (a[i] === b[j]) ? (size[i + 1][j + 1] + 1) : Math.max(size[i + 1][j], size[i][j + 1]);
        }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while ((i < a.length) && (j < b.length)) {
        if (a[i] === b[j]) {
            out.push([i, j]);
            i++;
            j++;
        }
        else if (size[i + 1][j] >= size[i][j + 1]) {
            i++;
        }
        else {
            j++;
        }
    }
    return out;
}

export default service_command_diff;
