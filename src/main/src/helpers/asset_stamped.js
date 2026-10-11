const RE_IMPORT = /(\bfrom\s+|\bimport\s*\()(['"])(\.\/[\w./-]+\.js)\2/g;
const RE_SCRIPT = /(<script[^>]+src=")(\/[\w./-]+\.js)(")/g;

// The same text, with every address it pulls in marked by the stamp of the folder.
//
// A browser is free to keep a file it was given without being told for how long, and it does:
// the control page was still running last night's form hours after the file changed, with no
// sign of it on screen. A stamped address ends that argument — the page asks for something the
// browser has never seen, so it gets what is on disk.
function asset_stamped(text, stamp)
{
    return text
        .replace(RE_IMPORT, (all, head, quote, file) => `${head}${quote}${file}?v=${stamp}${quote}`)
        .replace(RE_SCRIPT, (all, head, file, tail) => `${head}${file}?v=${stamp}${tail}`);
}

module.exports = asset_stamped;
