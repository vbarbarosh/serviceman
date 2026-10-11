const REPLACEMENTS = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'};

// Hostnames, service names and docker errors all reach the page as text
function html_escape(text)
{
    return String(((text === null) || (text === undefined)) ? '' : text).replace(/[&<>"']/g, v => REPLACEMENTS[v]);
}

module.exports = html_escape;
