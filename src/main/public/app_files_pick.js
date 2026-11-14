// What was given to the page as an app: one file (a zip, or what the caller takes besides), or a
// folder with every file in it. A folder comes from a picker (<input webkitdirectory>, each file
// with its path from the folder) or from a drop, where it is walked through the browser's
// entries. Several things dropped at once are counted, not one of them taken in their place.
//
//     {file: File} | {folder: [{path, file}]} | {several: number} | null
async function app_files_pick(input)
{
    if (input instanceof DataTransfer) {
        return dropped(input);
    }
    const files = Array.from(input.files || []);
    if (files.length === 0) {
        return null;
    }
    if (input.webkitdirectory) {
        return {folder: files.map(v => ({path: v.webkitRelativePath, file: v}))};
    }
    return {file: files[0]};
}

async function dropped(transfer)
{
    // The entries are taken before the first await: a drop's items are gone once its event is over
    const items = Array.from(transfer.items).filter(v => v.kind === 'file');
    if (items.length > 1) {
        return {several: items.length};
    }
    const entry = ((items.length === 0) || (typeof items[0].webkitGetAsEntry !== 'function')) ? null : items[0].webkitGetAsEntry();
    if ((entry !== null) && entry.isDirectory) {
        const files = [];
        await folder_walk(entry, files);
        return {folder: files};
    }
    const file = transfer.files[0];
    return (file === undefined) ? null : {file};
}

// Every file under a folder entry, with its path from the folder dropped, appdir/bin/run
async function folder_walk(entry, out)
{
    const reader = entry.createReader();
    // A reader gives a folder's entries a hundred or so at a time, then an empty batch
    for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) {
            return;
        }
        for (const child of batch) {
            if (child.isDirectory) {
                await folder_walk(child, out);
                continue;
            }
            const file = await new Promise((resolve, reject) => child.file(resolve, reject));
            out.push({path: child.fullPath.replace(/^\/+/, ''), file});
        }
    }
}

export default app_files_pick;
