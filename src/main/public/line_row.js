// A line as a service's Logs tab draws it: its time to the millisecond (the day and the zone in
// its tooltip), its words without the codes that colour a terminal, a red edge when it says
// error and an amber one when it says warn or warning, as a word of its own in any case, and
// whether it came on stderr
//
//     item    {time_ms, line, stream}, as GET /api/v1/services/<name>/lines gives it
//
//     {time: '23:42:16.832', when: 'Fri Nov 20 2026 23:42:16 GMT+0000 (…)', text: 'main: model loaded', kind: '', stderr: false}
function line_row(item)
{
    const at = new Date(item.time_ms);
    const text = item.line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    const kind = /\berror\b/i.test(text) ? 'line-error' : (/\bwarn(ing)?\b/i.test(text) ? 'line-warn' : '');
    return {time: `${at.toTimeString().slice(0, 8)}.${String(at.getMilliseconds()).padStart(3, '0')}`, when: at.toString(), text, kind, stderr: (item.stream === 'stderr')};
}

export default line_row;
