// What a refusal of the Docker Engine API says, in a line: its message when it gave one
function engine_said(answer)
{
    let message = answer.body.trim();
    try {
        message = JSON.parse(answer.body).message || message;
    }
    catch {
        // Not JSON: the text as it came
    }
    return `docker answered ${answer.status}: ${message}`;
}

module.exports = engine_said;
