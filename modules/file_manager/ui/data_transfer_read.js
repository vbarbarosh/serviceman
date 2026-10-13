// What a drop or a paste carries: each file with the folder it sits in under the one taken
// ('' for a file taken by itself), the folders with nothing in them, and the names that could
// not be read. A folder is read file by file, its inner folders too, when `folders` says the
// dialog takes them.
//
// The entries are taken before the first await: the browser empties the transfer once the
// handler yields. Where there are no entries (a paste in some browsers), the plain files are
// taken, and one that cannot be read — a folder seen as a file — is named, not sent.
async function data_transfer_read(transfer, folders)
{
    const entries = Array.from(transfer.items).filter(v => v.kind === 'file').map(v => (v.webkitGetAsEntry ? v.webkitGetAsEntry() : null));
    const loose = Array.from(transfer.files);
    const out = {files: [], dirs: [], unread: []};
    if ((entries.length > 0) && entries.every(v => v !== null)) {
        for (const entry of entries) {
            if (entry.isFile || folders) {
                await entry_read(entry, '', out);
            }
            else {
                out.unread.push(entry.name);
            }
        }
        return out;
    }
    for (const file of loose) {
        if (await is_file_readable(file)) {
            out.files.push({file, dir: ''});
        }
        else {
            out.unread.push(file.name);
        }
    }
    return out;
}

// A name the browser cannot read is named and left out; the rest still goes
async function entry_read(entry, dir, out)
{
    const here = ((dir === '') ? entry.name : `${dir}/${entry.name}`);
    try {
        if (entry.isFile) {
            out.files.push({file: await new Promise((resolve, reject) => entry.file(resolve, reject)), dir});
            return;
        }
        // A folder comes in batches, a hundred names at a time in Chrome, until one is empty
        const reader = entry.createReader();
        let count = 0;
        for (;;) {
            const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
            if (children.length === 0) {
                break;
            }
            count += children.length;
            for (const child of children) {
                await entry_read(child, here, out);
            }
        }
        if (count === 0) {
            out.dirs.push(here);
        }
    }
    catch (error) {
        out.unread.push(here);
    }
}

// A folder handed over as a file has no bytes to give: reading its first one fails
async function is_file_readable(file)
{
    try {
        await file.slice(0, 1).arrayBuffer();
        return true;
    }
    catch (error) {
        return false;
    }
}

export default data_transfer_read;
