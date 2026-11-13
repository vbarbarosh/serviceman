// What stands for a secret on the screen: the same dots for every one, so nothing of it shows,
// not even how long it is
const DOTS = '••••••••••••';

// A text as the screen shows it, every place it holds the secret drawn as dots. What Copy takes
// is still the text itself; a screenshot, a shared screen or a glance over the shoulder gets
// nothing.
function secret_hidden(text, secret)
{
    if ((typeof secret !== 'string') || (secret === '')) {
        return text;
    }
    return text.split(secret).join(DOTS);
}

export default secret_hidden;
