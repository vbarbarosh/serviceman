// Where a token's rights put one section (token_sections): 'none' with none of its rights,
// 'read' with what read gives and nothing more, 'write' with all of them, and 'fine' for any
// other choice of its rights, which only its fine ticks say. A read alone counts as held by the
// right it is under, as serviceman holds it: files alone is write, as a token made before
// files_read was.
function token_level_of(section, rights)
{
    const held = section.rights.filter(v => rights.includes(v) || rights.includes(section.under[v]));
    if (held.length === 0) {
        return 'none';
    }
    if ((section.read !== null) && (held.length === section.read.length) && section.read.every(v => held.includes(v))) {
        return 'read';
    }
    if ((section.write !== null) && (held.length === section.rights.length)) {
        return 'write';
    }
    return 'fine';
}

export default token_level_of;
