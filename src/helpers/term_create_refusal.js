// Why the variables and the folder asked for a new terminal cannot be given to its shell, or
// null when they can: `env` names to text, as a shell's variables are, and `cwd` a path. A
// value is never repeated in the answer: it may be a secret.
function term_create_refusal(env, cwd)
{
    if ((env !== undefined) && (env !== null)) {
        if ((typeof env !== 'object') || Array.isArray(env)) {
            return 'env is an object of variable names to their text';
        }
        for (const [name, value] of Object.entries(env)) {
            if (/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) === false) {
                return `a variable's name is letters, digits and _, not first a digit: ${JSON.stringify(name)}`;
            }
            if ((typeof value !== 'string') || value.includes('\0')) {
                return `the variable ${name} is text, with no NUL in it`;
            }
        }
    }
    if ((cwd !== undefined) && (cwd !== null) && ((typeof cwd !== 'string') || (cwd === '') || cwd.includes('\0'))) {
        return 'cwd is the path of a folder';
    }
    return null;
}

module.exports = term_create_refusal;
