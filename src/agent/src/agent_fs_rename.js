const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');
const path = require('path');

// One name carried to another — another folder included, which is what moving is. The same
// disk carries it in one step; another disk refuses, and the refusal is the answer.
//
// A name that is there is never replaced and never moved into, whatever it is — a file, a
// folder, full or empty, a link, live or leading nowhere: the answer is `<name> is there
// already`, the words a copy has for it, and both names stay as they were. Whoever asks may
// have read the folder a while ago, so the look is taken here, where the rename is made.
//
// A file gets its new name as a second one first, which the disk itself refuses when the name
// is taken, and then loses the old one: nothing made there since the look is written over. A
// folder and a link take no second name, and some disks give a file none: those are renamed
// after the look. A folder can then replace only an empty folder made in between; a link, and
// a file on such a disk, a file made in between.
async function agent_fs_rename(params)
{
    const from = agent_fs_path(params.from, params.root);
    const to = agent_fs_path(params.to, params.root);
    const source = fs.lstatSync(from, {bigint: true});
    // Onto itself: it is where it was asked to be
    if (from === to) {
        return {};
    }
    const there = fs.lstatSync(to, {bigint: true, throwIfNoEntry: false});
    if (there !== undefined) {
        if (same_name(source, there) === false) {
            throw new Error(`${path.basename(to) || to} is there already`);
        }
        await fs.promises.rename(from, to);
        return {};
    }
    if (source.isFile() && await file_linked(from, to)) {
        try {
            await fs.promises.unlink(from);
        }
        catch (error) {
            // The old name cannot go, so the new one does: a rename moves a name, it makes none
            await fs.promises.unlink(to).catch(() => null);
            throw error;
        }
        return {};
    }
    await fs.promises.rename(from, to);
    return {};
}

// The name asked for leads to the very thing renamed, and is its only name: another spelling
// of it on a disk that folds letters (Report.txt for report.txt), so nothing is there to
// lose. A file with a second name is not told from one beside it, and stays refused.
function same_name(source, there)
{
    return (there.dev === source.dev) && (there.ino === source.ino) && (source.isDirectory() || (Number(source.nlink) === 1));
}

// A second name for a file, made only when nothing has it: true when it is made, false when
// this disk gives it none (FAT, a file of another user), and rename has the answer
async function file_linked(from, to)
{
    try {
        await fs.promises.link(from, to);
        return true;
    }
    catch (error) {
        if (error.code === 'EEXIST') {
            throw new Error(`${path.basename(to)} is there already`);
        }
        return false;
    }
}

module.exports = agent_fs_rename;
