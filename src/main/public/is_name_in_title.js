// Whether a thing's name only repeats its title, so showing it beside the title says nothing:
// every word of the name is a word of the title (example beside example.com, vps-eu-1 beside
// vps.eu.1); laptop beside example.com says something and is shown. With no title the
// name stands in its place, and is not said twice.
function is_name_in_title(title, name)
{
    if (!title) {
        return true;
    }
    const title_words = words_of(title);
    return words_of(name).every(v => title_words.includes(v));
}

function words_of(text)
{
    return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export default is_name_in_title;
