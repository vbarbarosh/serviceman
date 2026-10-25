// The light-or-dark switch every page serviceman serves itself carries: the waiting page, the
// error pages and the index. One choice, kept where the control page keeps it, so a person who
// picks dark once is not asked again by the next page of the same host.
//
// The stamp runs before the first paint, or the page would flash the other theme on its way in.
function theme_switch()
{
    return {
        stamp: `
try {
    const kept = localStorage.getItem('serviceman.theme');
    if (kept) {
        document.documentElement.dataset.theme = kept;
    }
}
catch {
    // Storage that throws, in a private window say, is a theme not kept
}
`,
        button: `<button type="button" id="theme" title="Light or dark">
<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5"/></svg>
</button>`,
        toggle: `
document.getElementById('theme').addEventListener('click', function () {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const now = document.documentElement.dataset.theme || (dark ? 'dark' : 'light');
    const next = (now === 'dark' ? 'light' : 'dark');
    document.documentElement.dataset.theme = next;
    try {
        localStorage.setItem('serviceman.theme', next);
    }
    catch {
        // Not kept, but switched for this page
    }
});
`,
    };
}

module.exports = theme_switch;
