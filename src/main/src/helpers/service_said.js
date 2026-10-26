const KEEP_LINES = 60;

// The last words about one service while it is coming up: what its install line printed, what
// its program printed, what went wrong. The waiting page shows them, so somebody watching a
// slow start sees the work rather than a spinner.
//
// They are kept per service and thrown away when it starts again — this is the story of one
// start, not a log.
function service_said(app, words)
{
    if ((words === undefined) || (words === null) || (typeof words.service !== 'string') || (typeof words.text !== 'string')) {
        return;
    }
    const service = app.service_by_name[words.service];
    if (service === undefined) {
        return;
    }
    // A download that is being watched: the line is a number, not a sentence. It moves the
    // status the page shows and goes no further.
    const pull = service.state.pull;
    if ((pull !== null) && (pull !== undefined) && pull.read(words.text)) {
        const status = pull.status();
        if (status !== null) {
            service.state.doing = status.text;
            service.state.progress = status.ratio;
            service.state.progress_text = status.detail;
            // And the copy the page draws it as, the layers counted as files
            const copy = service.state.copy;
            if ((copy !== null) && (copy !== undefined) && (copy.unit === 'layer')) {
                Object.assign(copy, {files: status.layers, files_done: status.pulled, bytes_done: status.bytes_done, ratio: status.ratio});
            }
        }
        return;
    }
    service.state.said.push(words.text);
    while (service.state.said.length > KEEP_LINES) {
        service.state.said.shift();
    }
}

module.exports = service_said;
