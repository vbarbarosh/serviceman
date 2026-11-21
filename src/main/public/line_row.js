// A line as a service's Logs tab draws it: its time to the millisecond (the day and the zone in
// its tooltip), its words without the codes that colour a terminal, a red edge when it says
// error and an amber one when it says warn or warning, as a word of its own in any case, or when
// its severity says so, and whether it came on stderr; and what its detail shows once opened
//
//     item    a line as GET /api/v1/services/<name>/lines gives it: {time_ms, line, stream,
//             label_set, severity, subject, group, parent}, the last four only when it has them
//     sets    the answer's label_sets: [{name: value}], the label set of each line
//
//     {key, time: '23:42:16.832', day: '20 November', when: 'Fri Nov 20 2026 23:42:16 GMT+0000 (…)',
//      text: 'main: model loaded', kind: '', stderr: false, time_ms, severity, subject, group,
//      parent, labels}
function line_row(item, sets)
{
    const at = new Date(item.time_ms);
    const text = item.line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    const severity = item.severity || '';
    const kind = (/\berror\b/i.test(text) || /error|fatal|crit/i.test(severity)) ? 'line-error' : ((/\bwarn(ing)?\b/i.test(text) || /warn/i.test(severity)) ? 'line-warn' : '');
    return {
        // The same line in the next read: its time and its words
        key: `${item.time_ms}\n${item.line}`,
        time: `${at.toTimeString().slice(0, 8)}.${String(at.getMilliseconds()).padStart(3, '0')}`,
        day: at.toLocaleDateString('en-GB', {day: 'numeric', month: 'long'}),
        when: at.toString(),
        text,
        kind,
        stderr: (item.stream === 'stderr'),
        time_ms: item.time_ms,
        severity,
        subject: item.subject || '',
        group: item.group || '',
        parent: item.parent || '',
        labels: ((sets !== undefined) && (sets[item.label_set] !== undefined)) ? sets[item.label_set] : {},
    };
}

export default line_row;
