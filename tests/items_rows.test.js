const assert = require('assert');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');

// A machine's processes, as ps lists them: init, a shell under it with two children, and one
// whose parent is not in the list
const PROCS = [
    {pid: 1, ppid: 0, command: 'init', user: 'root', cpu: 0, rss: 10},
    {pid: 10, ppid: 1, command: 'bash', user: 'user', cpu: 1, rss: 30},
    {pid: 11, ppid: 10, command: 'node server.js', user: 'user', cpu: 50, rss: null},
    {pid: 12, ppid: 10, command: 'vim notes.md', user: 'user', cpu: 2, rss: 20},
    {pid: 40, ppid: 39, command: 'orphan', user: 'root', cpu: 3, rss: 5},
];
const PROC_KIND = {key: 'pid', search: ['command', 'user', 'pid'], tree: {id: 'pid', parent: 'ppid'}};

async function items_rows_of()
{
    return (await import(path.join(PUBLIC, 'items_rows.js'))).default;
}

function said(rows)
{
    return rows.map(v => `${'  '.repeat(v.depth)}${v.item.pid}${(v.hidden > 0) ? ` +${v.hidden}` : ''}${v.dim ? ' dim' : ''}`);
}

test('a tree by the field that names the parent; one whose parent is away stands as a root', async function () {
    const items_rows = await items_rows_of();
    const rows = items_rows(PROCS, PROC_KIND, {query: '', sort: null, closed: {}});
    assert.deepStrictEqual(said(rows), ['1', '  10', '    11', '    12', '40']);
    assert.deepStrictEqual(rows.map(v => v.children), [1, 2, 0, 0, 0]);
    assert.deepStrictEqual(rows.map(v => v.key), ['1', '10', '11', '12', '40']);
});

test('a folded branch keeps what is under it out of the list and says how many, all the way down', async function () {
    const items_rows = await items_rows_of();
    assert.deepStrictEqual(said(items_rows(PROCS, PROC_KIND, {query: '', sort: null, closed: {10: true}})), ['1', '  10 +2', '40']);
    assert.deepStrictEqual(said(items_rows(PROCS, PROC_KIND, {query: '', sort: null, closed: {1: true}})), ['1 +3', '40']);
});

test('a filter keeps every match in its place in the tree, the rows above it dimmed, and folds nothing', async function () {
    const items_rows = await items_rows_of();
    assert.deepStrictEqual(said(items_rows(PROCS, PROC_KIND, {query: 'vim', sort: null, closed: {1: true}})), ['1 dim', '  10 dim', '    12']);
    assert.deepStrictEqual(said(items_rows(PROCS, PROC_KIND, {query: 'USER node', sort: null, closed: {}})), ['1 dim', '  10 dim', '    11']);
    assert.deepStrictEqual(said(items_rows(PROCS, PROC_KIND, {query: 'nothing like it', sort: null, closed: {}})), []);
});

test('sorted by a column it is one list: figures by value, the empty last either way', async function () {
    const items_rows = await items_rows_of();
    assert.deepStrictEqual(said(items_rows(PROCS, PROC_KIND, {query: '', sort: {key: 'cpu', down: true}, closed: {}})), ['11', '40', '12', '10', '1']);
    assert.deepStrictEqual(said(items_rows(PROCS, PROC_KIND, {query: '', sort: {key: 'rss', down: true}, closed: {}})), ['10', '12', '1', '40', '11']);
    assert.deepStrictEqual(said(items_rows(PROCS, PROC_KIND, {query: '', sort: {key: 'rss', down: false}, closed: {}})), ['40', '1', '12', '10', '11']);
    assert.deepStrictEqual(said(items_rows(PROCS, PROC_KIND, {query: '', sort: {key: 'command', down: false}, closed: {}})), ['10', '1', '11', '40', '12']);
});

test('a list with no tree keeps the order it came in; a key of several fields names a device mounted twice', async function () {
    const items_rows = await items_rows_of();
    const disks = [
        {device: 'tmpfs', mounts: ['/run'], type: 'tmpfs'},
        {device: '/dev/sda1', mounts: ['/'], type: 'ext4'},
        {device: 'tmpfs', mounts: ['/dev/shm'], type: 'tmpfs'},
    ];
    const kind = {key: ['device', 'mounts'], search: ['device', 'mounts', 'type']};
    const rows = items_rows(disks, kind, {query: '', sort: null, closed: {}});
    assert.deepStrictEqual(rows.map(v => v.key), ['tmpfs /run', '/dev/sda1 /', 'tmpfs /dev/shm']);
    assert.deepStrictEqual(items_rows(disks, kind, {query: 'shm', sort: null, closed: {}}).map(v => v.key), ['tmpfs /dev/shm']);
});
