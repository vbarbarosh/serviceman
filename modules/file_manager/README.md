# file_manager

A file manager for a web page: walk folders, filter and sort them, tick names to rename,
move, delete or download, make folders, upload files or a whole folder by picker, drop or
Ctrl+V, open a text file in an
editor and save it, and open any file in a tab of its own, served as what it is — a video
seeks, a page finds its neighbours. A big file goes up in parts and carries on after a dropped
connection or a closed page, and a file can be copied from one disk to another by the server.

It has two halves and knows nothing of where the files are. The page half is a Vue
component that talks to an HTTP API under one base URL. The server half is that API, as one
request handler that asks a **disk** for everything. The host gives the disk, mounts the
handler at the base, and decides who may ask.

serviceman is the first host: its Remote tab is this component, and its disk is a machine
reached over the link that machine's agent dialled.

## Layout

    server/file_manager_serve.js   the HTTP API, given a disk
    server/transfer_queue.js       copies from one disk to another, in parts, run by the server
    server/tar_parser.js           a tar read as its bytes come, for the tar upload
    server/file_manager_transfers_serve.js   the HTTP API of those copies
    ui/file_manager.js             the component
    ui/upload_queue.js             the uploads, kept by the page so they outlive the component
    ui/data_transfer_read.js       what a drop or a paste carries, a folder read file by file
    ui/file_manager.css            the component's rules
    vendor_src/codemirror.js       what the editor takes from CodeMirror, for the host to bundle
    tests/                         the API over a disk held in memory

## The API

Under the base the host mounts it at — serviceman's is `/api/v1/remotes/<name>/fs`:

| Door | What it does |
|---|---|
| `GET <base>?path=<dir>` | one folder: `{path, items: [{name, kind: dir or file, size, mtime_ms}]}`; no path is the disk's starting folder |
| `GET <base>?path=<dir>&tree=1&hash=sha256&skip=<names>` | every name under the folder, at any depth, in one answer or as events (below) |
| `GET <base>/file/<path>` | the file, with its content type; `HEAD` for the size; one `bytes=` range as 206 |
| `GET <base>/tar?dir=<dir>&names=<a>&names=<b>` | several names of one folder as one tar |
| `POST <base>/rename` `{from, to}` | a name carried to another, another folder included |
| `POST <base>/delete` `{path}` | a file or a whole folder, gone |
| `POST <base>/mkdir` `{path}` | the whole path made, as `mkdir -p` does |
| `POST <base>/upload?dir=<dir>&name=<name>` | the body as a file: `{path, bytes, replaced}` |
| `POST <base>/upload/tar?dir=<dir>` | many files and folders as one tar, written as the bytes come: `{files, bytes}` once the body is over (below) |
| `GET <base>/upload/part?dir=&name=&id=` | how much of a file in parts is in: `{received}` |
| `POST <base>/upload/part?dir=&name=&id=&offset=` | one part, written at `offset`: `{received}` |
| `POST <base>/upload/finish?dir=&name=&id=&size=` | the parts become the file once `size` bytes are in: `{path, bytes, replaced}` |
| `POST <base>/upload/cancel?dir=&name=&id=` | what came of the parts goes |
| `GET <base>/watch?path=<dir>&tree=1&skip=<name>` | the folder watched, as server-sent events while the request stays open (below) |
| `GET <base>/room?path=<dir>` | the room left on the folder's disk, for an upload to check it fits: `{bytes_free, inodes_free}`, `inodes_free` null where the disk counts none; a folder not made yet is measured at the nearest one that is |

A refusal of the disk is a 502 with `{error}`; a request the API cannot take is a 400; a disk
that keeps no parts answers the part doors with 501, and one that cannot say its room (an agent
from before 1.14.0) answers `room` with 501, so the page uploads without checking.

### Many files as one tar

`POST <base>/upload/tar?dir=<dir>` takes a whole drop as one stream, the way
`tar | pv | socat` sends it: the page only watches the bytes go, and no file waits for the one
before it to be confirmed. The body is a tar (ustar; a longer name as GNU's `././@LongLink` or
a pax `path`, or in ustar's prefix), its names relative to the folder and `/`-separated. Files
and folders are made, folders as needed; any other entry (a link, a device) is passed over. The
machine writes each file beside its name until its last byte is in, then gives it the name and the
time the tar says, so after a cut stream a listing tells by name, size and time which files are
whole; a file cut halfway is not there at all. A container's disk is docker's own unpack,
which keeps the times too but writes a file under its name as it comes.

Every name is read by the server on the way through. A name that is absolute or walks out with
`..`, a body that is not a tar, or one that ends before the tar does, is a 400: before the disk
is asked when it is the first entry, otherwise after the entries before it are written. The
answer, when the body is over, is `{files, bytes}`: the files written and their bytes. A disk
that takes no tar (an agent from before 1.14.0) answers 501, and the page sends the files one
by one.

### A file in parts

The page draws an id for each upload of more than 1 MB and keeps it in `localStorage` under the
file (folder, name, size, date), so the same file chosen again for the same folder carries on
where it was.
Each part is 8 MB; a 413 from anything in front of the server halves it, down to 256 KB. A
part that fails for any other reason is tried again after 1, 2, 4… up to 30 seconds, and the
disk is asked first how much is in, so a part whose answer was lost is sent again from where
it began and written over. The disk keeps the parts beside the file, as
`.<name>.<id>.part`, so the rename that finishes them is one step on one disk; until then the
file's name is left as it was. Cancel drops the part. A part left by an upload nobody carries
on stays, as a dot file, until it is deleted.

### A whole tree

`GET <base>?path=<dir>&tree=1` reads every name under the folder, at any depth, in one request:
what a program copying a folder asks first, to know what is already there. Every name is one
object of one shape, its keys always in this order:

    [
        {"type": "file",  "path": "a.txt",        "size": 3,    "mtime_ms": 1760280000000, "sha256": "…"},
        {"type": "dir",   "path": "src",          "size": null, "mtime_ms": 1760280000000},
        {"type": "link",  "path": "src/latest",   "size": null, "mtime_ms": 1760280000000, "target": "../a.txt"},
        {"type": "other", "path": "run/app.sock", "size": null, "mtime_ms": 1760280000000},
        {"type": "error", "path": "closed",       "error": "EACCES: permission denied"},
        {"type": "end"}
    ]

- `type` is `file`, `dir`, `link`, `other` (a socket, a pipe, a device) or `error`; `size` is
  null but for a file. A link is said with its `target` and never followed.
- `path` is relative to the folder asked, `/` between its parts; one JSON is sorted by it.
- `hash=sha256` gives each file its `sha256`. The disk keeps each hash while the file's size,
  time and inode stay, so a second walk over files that did not change reads none of them.
- `skip` names what is left out and never descended into, wherever it is:
  `skip=.git,node_modules`, or `skip` given several times.
- Something that could not be read is an `error` object with its `path`, and the walk goes on:
  a folder that cannot be opened (it is still listed as a `dir`). A file whose hash could not be
  read stays a `file`, with `"sha256": null` and an `error`. An error says the reason, never the
  machine's full path. Checking for an `error` key catches both.
- **A whole list ends with `{"type": "end"}`.** One that stopped short ends with an error object
  with no path instead: a walk that broke half way, or one JSON of more than 50,000 names,
  `{"type": "error", "error": "more than 50000 names: the list stops here"}`.
- One JSON is a bare array, compact, with no indents.
- Asked with `Accept: text/event-stream`, the same objects come as events, each the moment it is
  read, one plain `data:` line each, with no event names: `data: {"type": "file", …}`. Events
  have no limit; closing the request stops the walk. Read them with `fetch`: an `EventSource`
  asks again by itself when the stream closes, and would walk the tree again and again.
- `delay=<ms>`, up to 1000, spaces the events out by that much, for watching a page fill while
  it is built; the walk on the machine waits for them. It is for events only: one JSON asked
  with a delay is a 400.
- A folder that cannot be read at all is a 502 before anything is sent; a disk that cannot walk
  a tree (a container's) answers 501; a machine whose agent is from before this shape, a 400.
- Without `tree`, the answer is the one folder, as above.

`node demos/tree-web/server.js` is a page for trying it on serviceman's machines: a folder, a
hash and names to skip, then One JSON or As events, with the counts, the list and each request.
`tree` and `tree_events` in `demos/files-web/fs_client.mjs` are the calls to copy.

### A folder watched

`GET <base>/watch?path=<dir>` answers once the watch holds (a folder that cannot be watched is a
502), then sends one event a change, until the page closes the request:

    event: ready      {"type": "ready", "path": "/home/me/notes", "tree": false, "skip": []}
    event: created    {"type": "created", "path": "a.txt", "kind": "file", "size": 3, "mtime_ms": …}
    event: changed    {"type": "changed", "path": "a.txt", "kind": "file", "size": 6, "mtime_ms": …}
    event: removed    {"type": "removed", "path": "a.txt", "kind": "file", "size": null, "mtime_ms": null}
    event: resync     {"type": "resync", "why": "…"}
    event: error      {"error": "/home/me/notes is gone"}, and the stream ends

- `path` of an event is relative to the folder watched. A folder says created and removed, never
  changed.
- A file is told about once it has been quiet for 300 ms, so one being written is not fetched
  half way; one written for longer is told about every 5 seconds.
- `tree=1` watches every folder under it too, but the names given as `skip` (`node_modules`,
  `.git`), wherever they are. A folder made later says what it already held as created. More
  than 5000 folders is refused: each one is an inotify watch of the machine's user.
- Events say what changed, the list says what is there. Open the watch, wait for `ready`, then
  list; list again after `resync`, and after the stream ends and is opened again.
- A comment line comes every 15 seconds, so a proxy does not close a quiet watch.

## The disk

    {
        list(path)              -> {path, items}         path is null or '' for the starting folder
        stat(path)              -> {kind, size, mtime_ms}
        read(path, range)       -> a readable stream     range is null or {start, end}
        tar(dir, names)         -> a readable stream
        write(dir, name, req)   -> {path, bytes, replaced}
        rename(from, to)        -> {}
        remove(path)            -> {}
        mkdir(path)             -> {}

        part_stat(dir, name, id)                  -> {received}
        part_write(dir, name, id, offset, source) -> {received}   source is a readable stream
        part_finish(dir, name, id, size)          -> {path, bytes, replaced}
        part_remove(dir, name, id)                -> {}

        watch(path, {tree, skip})                 -> a readable stream of JSON lines
    }

The four part calls are optional: without `part_write` the page sends every file in one piece.
`watch` is optional too: without it the watch door answers 501.

The calls that answer with an object may return a promise. `read` and `tar` return the stream
itself and may throw at once.

## Copies between disks

A file goes from one disk to another through the server, which runs the copy: a page that
closes does not stop it. The copy reads the file in ranges from one disk and writes it in
parts to the other (32 MB each), so a disk that drops is waited for, and the copy carries on
from where the other disk says it stands. One copy runs at a time, in the order they were
asked for. Folders are not copied yet.

    const queue = transfer_queue({
        disk_of: function (name) {
            // the disk of that name, or null while it cannot be reached
        },
        log: function (event, fields) {
        },
    });

    // every request under /transfers goes here; the host checks who may ask first
    await file_manager_transfers_serve(req, res, {queue, tail, disk_known: v => names.includes(v)});

| Door | What it does |
|---|---|
| `GET <base>` | `{items: [{id, from: {disk, path}, to: {disk, dir}, name, size, received, phase, said, wait_s, ms, began_at, path}]}` |
| `POST <base>` `{from: {disk, path}, to: {disk, dir}}` | a new copy; it waits for the ones before it |
| `POST <base>/<id>/cancel` | the copy stops and its part goes |
| `POST <base>/clear` | what is over is taken off the list |

`phase` is `waiting`, `copying`, `retrying` (with `said` and `wait_s`), `ok`, `cancelled` or
`error`. The list is kept in memory: a server that restarts forgets it, and the part already on
the disk is left there.

## Plugging it into a host

The server half, mounted at a base:

    const file_manager_serve = require('../modules/file_manager/server/file_manager_serve');

    // every request under /files goes to the module; the host checks who may ask first
    await file_manager_serve(req, res, {
        disk,                       // the eight calls above
        tail: '/file/a/b.txt',      // the address after the base
        name: 'box',                // a tar of the root folder is saved as box.tar
        log: function (event, fields) {
        },
    });

The page half: the host serves `ui/` and maps it, with Vue and a CodeMirror bundle made from
`vendor_src/codemirror.js`, in its import map:

    <link rel="stylesheet" href="/modules/file_manager/file_manager.css">
    <script type="importmap">
    {"imports": {"codemirror": "/vendor/codemirror.mjs", "file_manager/": "/modules/file_manager/", "vue": "/vendor/vue.esm-browser.prod.js"}}
    </script>

    import file_manager from 'file_manager/file_manager.js';

    <file-manager base="/files" :theme="theme" :offline="false"/>

| Prop | |
|---|---|
| `base` | where the API is |
| `theme` | `light` or `dark`, for the editor |
| `offline` | true greys out everything that asks the disk |
| `open_base` | where a file opens in a tab of its own, its path appended; `<base>/file` by default |
| `title` | the name of the place, in the question before a delete |
| `user` | who the files are written as, in the hint on a drop |
| `home_title` | what the home button says it goes to |
| `start` | the folder opened first; the disk's starting folder when none |
| `transfers` | where the host's copies between disks are; without it there is no Copy to… |
| `disk` | this disk's name among them |
| `targets` | the other disks a file may be copied to: `[{value, label}]` |

### Files and folders from outside

What the dialogs take, a drop takes, as the rulebook's UIM-04 to UIM-06 ask:

- **Upload files** and **Upload folder** open the dialogs; a folder goes with its inner folders.
- Files or folders dropped anywhere on the file manager are copied into the folder it shows; it
  lights up while they are over it. A folder is read file by file, its inner folders too.
- **Ctrl+V** with files or a folder in the clipboard does what a drop does, anywhere in the tab
  but a field or the editor; a paste of text is left alone.
- A folder's own folders are made first, the deepest of each branch as `mkdir -p` does, empty
  ones included: a container's disk writes a file only into a folder that is there.
- Each file goes up under its way from the folder taken (`photos/2024/a.jpg`), A to Z. A name
  the browser cannot read is a failed row in Uploads, the rest still goes.
- A big drop is counted first (Counting… 1,284 files · 812 MB so far, with Cancel); nothing goes
  before it is.
- Before more than one file goes, `<base>/room` says whether the disk has the bytes and the
  inodes for them (a file and a folder are one each). When not, Uploads asks: **Copy what fits**,
  as far as they reach in the order they go, or **Don't copy**. A disk that cannot say lets
  everything go.
- The files taken at once go as one stream, a tar (below), in pieces of about a minute each at
  the speed seen (1 to 64 MB, halved on a 413), since a server cuts a request at five minutes and
  a proxy may refuse a big body. A file over 64 MB, a single file, and every file of a disk that
  takes no tar go one by one: in parts that carry on after a break, or whole up to 1 MB.
- Uploads shows the speed across the copy as a graph, the part done shaded and the speed now a
  dashed line; under it the time left, the files left and the file under way. **Pause** stops
  the stream where it is; **Resume** sends what is not in yet.
- Its rows are nine: two done, the file under way, the next ones, sliding up a place as each
  file goes; the failed stay on top, and **Show all** lists every one. A file of a stream is
  `sent` once its bytes have gone, and done when the stream ends whole. A stream cut or still
  for 30 seconds lists the folders of its files: what is there at its size and date is done,
  the rest goes again.
- A file that lands in the folder shown reads it again, at most once a second and in place: the
  ticks stay. One that lands deeper changes nothing the list shows, and reads nothing.
- A file dropped anywhere else on the page never opens in the tab and loses it.

The host page gives the colours, as `--bg`, `--panel`, `--fg`, `--muted`, `--line`, `--hover`
and `--accent`, and the classes the component shares with the rest of the page: `card`, `chip`,
`primary`, `danger`, `muted`, `bad`, `list-tools`, `list-table`, `meter`. It also stops
`dragstart` on the whole page (Chrome on Wayland can hold a drag, and every click with it).

## In serviceman

- `src/main/src/routes/handle_control_request.js` sends `/api/v1/remotes/<name>/fs…`, and
  `<name>.fs.<control host>`, to `file_manager_serve`, after its own refusals: no such machine,
  not connected, an agent too old to read folders
- `src/main/src/helpers/remote_disk.js` is the disk: each call goes to the machine's agent;
  an agent keeps the parts of a file with `agent_file_part_put` and its `stat`, `finish` and
  `remove` calls, and says so as `file_parts`; it measures the room of a folder's disk with
  `agent_fs_room` (statfs), and says so as `fs_room`; it writes a tar with `agent_tar_put`,
  which reads it with this module's `tar_parser`, and says so as `tar_put`
- `/api/v1/transfers` is the copies between machines; a machine is a disk while it is
  connected with an agent that keeps parts
- `src/main/public/serviceman.js` has `remote_files`, the Remote tab, which wraps the component
- `src/main/public/index.html` loads the css and maps `file_manager/`; the control server
  serves `ui/` at `/modules/file_manager/`
- `bin/vendor` bundles `vendor_src/codemirror.js`

## Tests

    node --test modules/file_manager/tests/*.test.js
