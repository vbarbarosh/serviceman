const assert = require('assert');
const test = require('node:test');

test('a dropped folder is read file by file, its inner folders and empty ones too, in batches as Chrome gives them', async function () {
    const data_transfer_read = (await import('../ui/data_transfer_read.js')).default;
    const many = Array.from({length: 250}, (v, index) => entry_file(`p${index}.jpg`));
    const transfer = transfer_of([
        entry_dir('photos', [entry_file('a.jpg'), entry_dir('2024', many), entry_dir('empty', []), entry_dir('deep', [entry_dir('er', [])])]),
        entry_file('loose.txt'),
    ]);
    const read = await data_transfer_read(transfer, true);
    assert.strictEqual(read.files.length, 252);
    assert.deepStrictEqual(read.files.slice(0, 3).map(v => [v.dir, v.file.name]), [['photos', 'a.jpg'], ['photos/2024', 'p0.jpg'], ['photos/2024', 'p1.jpg']]);
    assert.deepStrictEqual(read.files.at(-1).dir, '');
    assert.deepStrictEqual(read.dirs, ['photos/empty', 'photos/deep/er']);
    assert.deepStrictEqual(read.unread, []);
});

test('a folder is named, not read, where the dialog takes no folders', async function () {
    const data_transfer_read = (await import('../ui/data_transfer_read.js')).default;
    const read = await data_transfer_read(transfer_of([entry_dir('photos', [entry_file('a.jpg')]), entry_file('b.txt')]), false);
    assert.deepStrictEqual(read.files.map(v => v.file.name), ['b.txt']);
    assert.deepStrictEqual(read.unread, ['photos']);
});

test('with no entries, as some pastes come, the files are taken as they are and a folder that cannot be read is named', async function () {
    const data_transfer_read = (await import('../ui/data_transfer_read.js')).default;
    const folder = new File([], 'photos');
    folder.slice = function () {
        return {arrayBuffer: () => Promise.reject(new Error('NotReadableError'))};
    };
    const transfer = {items: [{kind: 'file', webkitGetAsEntry: () => null}, {kind: 'file', webkitGetAsEntry: () => null}, {kind: 'string'}], files: [new File(['hi'], 'a.txt'), folder]};
    const read = await data_transfer_read(transfer, true);
    assert.deepStrictEqual(read.files.map(v => [v.dir, v.file.name]), [['', 'a.txt']]);
    assert.deepStrictEqual(read.unread, ['photos']);
});

// A drop as the browser hands it: items with their entries, and the plain files beside them
function transfer_of(entries)
{
    return {items: entries.map(v => ({kind: 'file', webkitGetAsEntry: () => v})), files: []};
}

function entry_file(name)
{
    return {isFile: true, isDirectory: false, name, file: v => setTimeout(() => v(new File(['x'], name)))};
}

// A folder whose reader gives a hundred names at a time, then an empty batch, as Chrome does
function entry_dir(name, children)
{
    return {
        isFile: false,
        isDirectory: true,
        name,
        createReader: function () {
            let offset = 0;
            return {
                readEntries: function (resolve) {
                    const batch = children.slice(offset, offset + 100);
                    offset += batch.length;
                    setTimeout(() => resolve(batch));
                },
            };
        },
    };
}
