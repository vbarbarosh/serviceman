// navigator.clipboard is only there in a secure context — the control page on localhost has
// one, the same page opened by ip address on the network does not — and even there a browser
// may refuse. The old way is tried whenever the new one does not happen.
async function to_clipboard(text)
{
    if (window.isSecureContext && (navigator.clipboard !== undefined)) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        }
        catch {
            // It said no; the textarea below is still allowed
        }
    }
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.className = 'snip-away';
    document.body.appendChild(box);
    box.select();
    const out = document.execCommand('copy');
    box.remove();
    return out;
}

export default to_clipboard;
