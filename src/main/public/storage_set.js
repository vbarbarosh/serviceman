// A choice kept in this browser under a name; one that cannot be kept is kept for this page alone
function storage_set(name, value)
{
    try {
        if (value === null) {
            localStorage.removeItem(name);
        }
        else {
            localStorage.setItem(name, value);
        }
        return true;
    }
    catch {
        return false;
    }
}

export default storage_set;
