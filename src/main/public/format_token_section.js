import token_level_of from './token_level_of.js';

// One section of a token's rights in a few words, for its row on the Tokens page: "files read",
// "apps write", or for a choice of its rights, those rights, "machines: status, metrics"; an
// empty string for a section it has none of
function format_token_section(section, rights)
{
    const level = token_level_of(section, rights);
    if (level === 'none') {
        return '';
    }
    const name = section.label.toLowerCase();
    if (level === 'fine') {
        return `${name}: ${section.rights.filter(v => rights.includes(v)).join(', ')}`;
    }
    return `${name} ${level}`;
}

export default format_token_section;
