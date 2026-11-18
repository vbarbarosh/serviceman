import token_sections from './token_sections.js';

// The rights with one section set to none, read or write (token_sections), the other sections'
// as they were. They come in the order the sections give them, and a right no section names is
// kept, last.
function token_section_set(rights, section, level)
{
    const given = {none: [], read: section.read, write: section.write}[level];
    if ((given === undefined) || (given === null)) {
        throw new Error(`${section.label} cannot be set to ${level}`);
    }
    const kept = rights.filter(v => (section.rights.includes(v) === false)).concat(given);
    const named = token_sections.flatMap(v => v.rights);
    return named.filter(v => kept.includes(v)).concat(kept.filter(v => (named.includes(v) === false)));
}

export default token_section_set;
