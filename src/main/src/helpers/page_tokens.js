// The one set of colours every page serviceman serves carries: the control page, the index a
// visitor lands on, the page that says a service is starting and the page that says it did not.
// These were near-copies that disagreed in the third hex digit — a visitor moving between two
// of them saw the greys change. The control page's stylesheet holds the same values, because a
// static file cannot require this one.
const LIGHT = {
    bg: '#f4f6f8',
    panel: '#ffffff',
    fg: '#1b1d21',
    muted: '#6b7280',
    line: '#e2e6ea',
    accent: '#2f6fed',
    hover: '#eef2f7',
    run: '#1e9e63',
    idle: '#9aa1ab',
    busy: '#d38b12',
    bad: '#c0392b',
};

// Olive 3, the author's own dark theme, by the role each colour plays
const DARK = {
    bg: '#3a392e',
    panel: '#1e1d21',
    fg: '#e8e6dc',
    muted: '#bab8ab',
    line: '#45443a',
    accent: '#1299da',
    hover: '#2e2d33',
    run: '#56db3a',
    idle: '#bab8ab',
    busy: '#ff8400',
    bad: '#ff6b6b',
};

// Dark twice on purpose: once for a visitor who has never chosen, and once for one who has.
// The first must not answer for a visitor who chose light on an earlier page of the same host.
function page_tokens()
{
    return `:root {
    color-scheme: light;
${lines(LIGHT, '    ')}
}
@media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
        color-scheme: dark;
${lines(DARK, '        ')}
    }
}
:root[data-theme="dark"] {
    color-scheme: dark;
${lines(DARK, '    ')}
}`;
}

// One custom property to a line, indented to sit inside the rule that carries it
function lines(tokens, pad)
{
    const declarations = [];
    for (const name of Object.keys(tokens)) {
        declarations.push(`${pad}--${name}: ${tokens[name]};`);
    }
    return declarations.join('\n');
}

module.exports = page_tokens;
