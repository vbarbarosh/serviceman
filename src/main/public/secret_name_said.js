// The names the secrets door takes: its RE_SECRET (handle_control_request.js), written here a
// second time so that a form can say so before it asks. tests/serve.test.js asks the door
// itself about every character, and fails when the two part ways.
const RE_SECRET_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

// What is wrong with a secret's name, in words for under its box, or '' for a name the door
// takes. An empty one is a box nobody has filled in yet, and nothing is said of it.
function secret_name_said(name)
{
    const text = String(name).trim();
    if ((text === '') || RE_SECRET_NAME.test(text)) {
        return '';
    }
    return 'A secret\'s name is letters, digits, - . and _ only, starting with a letter or a digit.';
}

export default secret_name_said;
