// What this browser kept under a name, or null: storage that throws, in a private window or
// with site data blocked, is a choice not kept, never a page that fails to render
function storage_get(name)
{
    try {
        return localStorage.getItem(name);
    }
    catch {
        return null;
    }
}

export default storage_get;
