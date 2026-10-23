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
run over there by the machine's agent.

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

    {at, commands: ['df -PkT', 'df -PiT'],
     items: [{device, type, mounts, disk, total, used, free, inodes_total, inodes_used,
              inodes_free, encrypted, key_of}]}

- `mounts` is every place the device is mounted at, the first one its own; `disk` is false for
  tmpfs, overlay and loop mounts, which the list hides until asked.
- `total`, `used`, `free` are bytes; the inodes are `null` where the filesystem does not count
  them.
- `key_of` names the pool whose key this small volume holds (Ubuntu's encrypted ZFS), or null.
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
