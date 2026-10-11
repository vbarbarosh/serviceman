// Where one remote's sending to Logline stands: one word for the pill, and a sentence for why
function logline_stage(view)
{
    const logline = view.logline;
    const machine = view.machine;
    if (logline.logs === 'off') {
        return {pill: '', text: 'Off', detail: 'This remote’s logs stay on it.'};
    }
    if (logline.endpoint === null) {
        return {pill: 'failed', text: 'Nowhere to send', detail: 'It is switched on, and nobody has said where Logline is yet — on the Logline page.'};
    }
    if (view.phase !== 'online') {
        return {pill: '', text: 'Offline', detail: 'It is switched on, and is told where to send when its agent dials in.'};
    }
    if ((machine !== null) && (machine.can !== null) && (machine.can.includes('logline') === false)) {
        return {pill: 'failed', text: 'Agent too old', detail: 'Its agent is from before Logline; it is told as soon as it runs the one this host serves.'};
    }
    if (logline.error !== null) {
        return {pill: 'failed', text: 'Not told', detail: 'serviceman could not tell it where to send; it tries again every minute.'};
    }
    if (logline.floor === null) {
        return {pill: 'starting', text: 'Telling it…', detail: 'The remote is being told the endpoint, its token and the moment it starts from.'};
    }
    const status = logline.status;
    if ((status === null) || (status.collecting === false)) {
        return {pill: 'starting', text: 'Switched on', detail: 'The remote holds the endpoint, its token and the moment it starts from. It does not collect yet: reading the containers is the part still being built.'};
    }
    if ((status.last_answer !== null) && (status.last_answer !== 'ok')) {
        return {pill: 'failed', text: 'Held back', detail: `Logline answered: ${status.last_answer}. The lines wait on the remote and are sent again.`};
    }
    if (status.waiting.lines > 0) {
        return {pill: 'starting', text: 'Catching up', detail: 'Lines are waiting on the remote and going out.'};
    }
    return {pill: 'running', text: 'Active', detail: 'Every line so far is in Logline.'};
}

export default logline_stage;
