# file_manager

A file manager for a web page: walk folders, filter and sort them, tick names to rename,
move, delete or download, make folders, upload by picker or drop, open a text file in an
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
    server/file_manager_transfers_serve.js   the HTTP API of those copies
    ui/file_manager.js             the component
    ui/upload_queue.js             the uploads, kept by the page so they outlive the component
    ui/file_manager.css            the component's rules
    vendor_src/codemirror.js       what the editor takes from CodeMirror, for the host to bundle
    tests/                         the API over a disk held in memory

## The API

Under the base the host mounts it at — serviceman's is `/api/v1/remotes/<name>/fs`:

| Door | What it does |
|---|---|
| `GET <base>?path=<dir>` | one folder: `{path, items: [{name, kind: dir or file, size, mtime_ms}]}`; no path is the disk's starting folder |
| `GET <base>?path=<dir>&tree=1&hash=sha256&skip=<names>` | every file under the folder, at any depth, in one answer (below) |
| `GET <base>/file/<path>` | the file, with its content type; `HEAD` for the size; one `bytes=` range as 206 |
| `GET <base>/tar?dir=<dir>&names=<a>&names=<b>` | several names of one folder as one tar |
| `POST <base>/rename` `{from, to}` | a name carried to another, another folder included |
| `POST <base>/delete` `{path}` | a file or a whole folder, gone |
| `POST <base>/mkdir` `{path}` | the whole path made, as `mkdir -p` does |
| `POST <base>/upload?dir=<dir>&name=<name>` | the body as a file: `{path, bytes, replaced}` |
| `GET <base>/upload/part?dir=&name=&id=` | how much of a file in parts is in: `{received}` |
| `POST <base>/upload/part?dir=&name=&id=&offset=` | one part, written at `offset`: `{received}` |
| `POST <base>/upload/finish?dir=&name=&id=&size=` | the parts become the file once `size` bytes are in: `{path, bytes, replaced}` |
| `POST <base>/upload/cancel?dir=&name=&id=` | what came of the parts goes |
| `GET <base>/watch?path=<dir>&tree=1&skip=<name>` | the folder watched, as server-sent events while the request stays open (below) |

A refusal of the disk is a 502 with `{error}`; a request the API cannot take is a 400; a disk
that keeps no parts answers the part doors with 501.

### A file in parts

The page draws an id for each upload and keeps it in `localStorage` under the file (folder,
name, size, date), so the same file chosen again for the same folder carries on where it was.
Each part is 8 MB; a 413 from anything in front of the server halves it, down to 256 KB. A
part that fails for any other reason is tried again after 1, 2, 4… up to 30 seconds, and the
disk is asked first how much is in, so a part whose answer was lost is sent again from where
it began and written over. The disk keeps the parts beside the file, as
`.<name>.<id>.part`, so the rename that finishes them is one step on one disk; until then the
file's name is left as it was. Cancel drops the part. A part left by an upload nobody carries
on stays, as a dot file, until it is deleted.

### A whole tree

`GET <base>?path=<dir>&tree=1` reads every file under the folder, at any depth, in one request:
what a program copying a folder asks first, to know what is already there.

    {
        "path": "/home/me/project",
        "items": [
            {"path": "a.txt", "size": 3, "mtime_ms": 1760280000000, "kind": "file"},
            {"path": "src/link", "target": "../a.txt", "mtime_ms": 1760280000000, "kind": "link"}
        ],
        "unread": [{"path": "closed", "error": "EACCES: permission denied, …"}],
        "cut": false, "files": 1, "links": 1, "bytes": 3, "hashed": 0
    }

- `path` of an item is relative to the folder asked, `/` between its parts; the items are sorted
  by it. Folders are not said, only what is in them. A link is said as a link with its target,
  and never followed. A socket, a pipe or a device is left out.
- `hash=sha256` gives each file its `sha256`. The disk keeps each hash while the file's size,
  time and inode stay, so a second walk over files that did not change reads none of them;
  `hashed` says how many were read this time. A file it could not read has `sha256: null` and
  an `error`.
- `skip` names what is never descended into, wherever it is: `skip=.git,node_modules`, or
  `skip` given several times.
- One JSON holds at most 50,000 names. A bigger tree stops there and says `cut: true`, its
  counts those of what it holds and `hashed` null; there is no next page. The walk stops too.
- A folder or a name it could not read is in `unread`, and the walk goes on. A folder that
  cannot be read at all is a 502; a disk that cannot walk a tree (a container's) answers 501.
- Asked with `Accept: text/event-stream`, the same walk comes as events, each the moment it is
  read, so the caller sees it go: `start` `{path}`, then `file`, `link` and `unread`, each line
  as above with its `type`, and `end` `{files, links, bytes, hashed, ms}`. Events have no
  limit: closing the request stops the walk. A walk that fails half way ends with an `error`
  event. An `EventSource` closes itself on `end`, or it asks
  again.
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
  `remove` calls, and says so as `file_parts`
- `/api/v1/transfers` is the copies between machines; a machine is a disk while it is
  connected with an agent that keeps parts
- `src/main/public/serviceman.js` has `remote_files`, the Remote tab, which wraps the component
- `src/main/public/index.html` loads the css and maps `file_manager/`; the control server
  serves `ui/` at `/modules/file_manager/`
- `bin/vendor` bundles `vendor_src/codemirror.js`

## Tests

    node --test modules/file_manager/tests/*.test.js
