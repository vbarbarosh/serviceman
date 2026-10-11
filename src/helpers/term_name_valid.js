// A terminal's name is a file name on the machine and a word in the page's address, so it is
// kept to what is safe in both
function term_name_valid(name)
{
    return ((typeof name === 'string') && /^[A-Za-z0-9_-]{1,64}$/.test(name));
}

module.exports = term_name_valid;
