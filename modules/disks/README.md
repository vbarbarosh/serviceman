# disks

The disks of one machine, for a web page: every filesystem it has mounted, the room each has
and the files it may still hold, side by side, since a disk out of inodes refuses new files with
space to spare. A bar turns amber at three quarters and red at nine tenths. The disks come
first; tmpfs, overlay and loop mounts show on a chip. A device mounted in several places names
them all, and an encrypted one says so.

It has two halves and knows nothing of where the machine is. The page half is a Vue component
that talks to an HTTP API under one base URL. The server half is that API, as one request
handler that asks the host to **read** the list. The host gives the read, mounts the handler at
the base, and decides who may ask.

serviceman is the first host: its Disks tab of a machine is this component, and the read is `df`
run over there by the machine's agent. **What takes the space**, on the list or on a disk's row,
counts that disk's folders and shows them biggest first, each with its share; a click on a folder
opens the folders inside it, counted then. Above them it says what the count cannot see: the
folders the agent could not read, files deleted but still held open, the space in no folder
counted, and what docker and the system journal keep. A machine's Overview leads there from its Disk card.

## Layout

    server/disks_serve.js         the HTTP API, given read()
    server/disks_manifest.js      its kinds of items and the commands on them
    ui/disks.js                   the component
    ui/disks.css                  the component's rules
    tests/disks_serve.test.js     the API over a fake read

## The API

What it holds and does is written down in `server/disks_manifest.js`, for a host to route,
give rights and show by: its kinds of items and the commands on them, in
[the shape every module has](../../README.md#modules).

Under the base the host mounts it at — serviceman's is `/api/v1/remotes/<name>/disks`.

| Door | What it does |
|---|---|
| `GET <base>` | what the host's `read()` answers, below |
| `GET <base>/usage?path=/var&extras=1` | what takes the space in one folder: the host's `usage({path, extras})` |
| `GET <base>/usage/progress?path=/var` | how a count of that folder goes while it runs: the host's `usage_progress({path})` |

    {at, commands: ['df -PkT', 'df -PiT'],
     items: [{device, type, mounts, disk, total, used, free, inodes_total, inodes_used,
              inodes_free, encrypted, key_of}]}

- `mounts` is every place the device is mounted at, the first one its own; `disk` is false for
  tmpfs, overlay and loop mounts, which the list hides until asked.
- `total`, `used`, `free` are bytes; the inodes are `null` where the filesystem does not count
  them.
- `key_of` names the pool whose key this small volume holds (Ubuntu's encrypted ZFS), or null.
- `usage` answers `{path, total, files, folders: [{path, size}], unread: [path], took_ms,
  type, parts: [{path, size}], deleted, extras}`: the folders in that folder with their sizes,
  biggest first, counted on its own disk alone (`du -x` over there), `files` what lies in the
  folder itself, `unread` the folders that could not be read, whose size is then in no folder;
  `rooted` is true when the machine counted it as root, which reads every folder. `type` is
  the filesystem's, `parts` the places in the folder where the same disk is mounted again on
  its own (a btrfs subvolume), counted apart and added in. `deleted` is `{size, programs: [{pid,
  name, size}]}`, files deleted but still open on that disk, for a folder a disk is mounted at
  (`null` for any other, and absent from an older agent). With `extras=1`, `extras` is
  `{docker: [{what, size}], docker_root, docker_driver, journal}`, what docker and the journal
  say they keep, the folder docker keeps it in and how, `null` where they cannot say.
- `usage_progress` answers `{path, counting, took_ms, folders: [{path, size}], waiting,
  waiting_shown: [path]}`: the folders counted so far, biggest first, how many are still to
  come and the first of them by name. `counting` is false when no count of that folder runs. Only names and sizes: nothing is read out of a file. A path that is not from
  the root is a 400.
- **Refusals:** a read that throws is a 502 with its message, or the status the error carries;
  any other door or method is a 404.

## Plugging it into a host

    const disks_serve = require('../modules/disks/server/disks_serve');

    await disks_serve(req, res, {
        read: () => ask_the_machine('disk_list'),   // -> {at, items, commands}
        tail: '',                                    // the address after the base
    });

The page half: the host serves `ui/` and maps it in its import map:

    <link rel="stylesheet" href="/modules/disks/disks.css">
    {"imports": {"disks/": "/modules/disks/", "vue": "/vendor/vue.esm-browser.prod.js"}}

    import disks from 'disks/disks.js';

    <disks base="/disks" :offline="false" :connected_at="1761164000000"/>

`connected_at` changes each time the machine dials back in, and a read that failed while it was
away is read again then. `offline` greys Read again.

The host page gives the colours and the classes the component shares with it: `list-tools`,
`list-right`, `chip`, `meter` (with `filling` and `full`), `tag`, `muted`, `bad`; its list is
the page's `items_view.js`, imported from beside it, which draws the columns the manifest names
(see [the shape every module has](../../README.md#modules)).

## In serviceman

- `src/main/src/routes/handle_control_request.js` sends `/api/v1/remotes/<name>/disks…` to
  `disks_serve`, after its own refusals: no such machine, not connected, an agent from before
  the disk list; its `read()` is the agent's `disk_list`
- the agent's `disk_list` (`src/agent/src/agent_disk_list.js`) runs `df -PkT` and `df -PiT` as
  the agent's own user; a df that cannot count inodes still gives the room
- `src/main/public/remote_disks.js` is the Disks tab, which wraps the component and says why
  there is no list for a machine not seen yet or an agent older than it

## Tests

    node --test modules/disks/tests/*.test.js tests/agent_disks.test.js
