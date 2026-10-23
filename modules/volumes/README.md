# volumes

Encrypted volumes of a machine, for a web page: LUKS in a file on the machine's disk, opened at a
folder of that machine. The page lists the volumes of several machines, with **Close** and
**Grow** from a row, and **Delete** on a closed one. **New volume…** makes one with a passphrase a person types, kept nowhere,
and **Open…** opens it again; Visual Agents makes and opens its own through the API, with keys
it holds.

A stolen disk or snapshot shows one file of random bytes and its size. While a volume is open, its
files are plain ext4 to everything on the machine: the owner's uid, podman bind mounts, inotify.
After a reboot every volume is closed; nothing on the machine can open it, since the key is never
kept there.

## Layout

    server/volumes_serve.js       the HTTP API, given call(params) and key_safe
    server/volumes_manifest.js    its kinds of items and the commands on them
    ui/volumes.js                 the list, for any number of machines
    ui/volumes.css                the component's rules
    tests/volumes_serve.test.js   the API over a fake machine

The work on the machine is the serviceman agent's (`src/agent/src/agent_volume.js`), done by its
root half: tests in `tests/agent_volume.test.js`.

## On the machine

- `/var/lib/serviceman/volumes/<name>.img`: the volume, a sparse file, LUKS2 with ext4 inside;
  `<name>.json` beside it: `{name, owner, target, created}`, and `passphrase: true` for one made
  with a typed passphrase.
- Opened as `/dev/mapper/serviceman-vol-<name>`, mounted at the target with
  `discard,nosuid,nodev`. The key goes to cryptsetup on stdin, never in argv; pbkdf2 at its
  fewest rounds when the key is random, argon2id at cryptsetup's measured cost when a person
  typed it. The keyring is left out, so Grow needs no key.
- A target is a folder in the owner's home. Plain files already there are copied in; the plain
  folder is kept beside it as `<target>.plain-<time>` for its owner to delete.

## The API

What it holds and does is written down in `server/volumes_manifest.js`, for a host to route,
give rights and show by: its kinds of items and the commands on them, in
[the shape every module has](../../README.md#modules).

Under the base the host mounts it at — serviceman's is `/api/v1/remotes/<name>/volumes`.
A volume is

    {name, owner, target, state: open|closed|missing, users, size, on_disk, used, free, created, passphrase?}

`users` is what holds it open now, `[{pid, user, command, how, terminal}]`, empty while it is
closed: `terminal` names the machine's terminal the process runs in, or is null. `size` is the file's, `on_disk` what it takes on the disk (sparse), `used` and `free` the file
system's while it is open, else null.

| Door | What it does |
|---|---|
| `GET <base>` | `{items: [volume], disk_free}` |
| `POST <base>` `{name, owner, target, size, key, passphrase, plain_remove}` | makes it and leaves it open; answers the volume and `plain_left`; `passphrase: true` when a person typed the key; `plain_remove: true` removes the plain copy once it is copied in, and `plain_left` is null |
| `POST <base>/<name>/open` `{key}` | opens it; open already answers `already: true`, once the key is tried |
| `POST <base>/<name>/close` | closes it |
| `POST <base>/<name>/grow` `{size}` | grows it while open, nothing stopped |
| `POST <base>/<name>/delete` | deletes a closed one for good: its file and its `.json`; its folder too when empty. Answers `{name, owner, target, target_left}`, `target_left` the folder when files written into it while closed kept it, else null |

- **Names and sizes:** a name is up to 40 small letters, digits and hyphens; a size is bytes or a
  number with K, M, G or T, at least 64 MB; a key is 16 to 4096 characters.
- **Refusals:** 400 for what is wrong in the request; 403 for a key that does not open it
  (`code: "wrong_key"`), and for a key that came over a link it may not travel on
  (`code: "key_not_safe"`) (plain http: only TLS, a socket file, the same
  machine, a page loaded from its `localhost`, or the tailnet); 404 for no such volume; 409 for a name or folder taken, a size above
  the disk's free space, a folder with files of its own at open, a delete while it is open, and a close while it is in use,
  which names `users: [{pid, user, command, how, terminal}]` (`how` is `cwd`, `root`, `open file` or
  `a container holds it`); 501 on a machine without the root agent or cryptsetup.
- **Not here:** shrinking a volume, changing its key.

## Plugging it into a host

    const volumes_serve = require('../modules/volumes/server/volumes_serve');

    await volumes_serve(req, res, {
        call: v => ask_the_machine('volume', v),     // -> the agent's answer
        key_safe: request_came_over_tls_or_locally,
        tail: '/projects/open',                // the address after the base
        log: function (event, fields) {
        },
    });

The page half: the host serves `ui/` and maps it in its import map, then gives the machines:

    <link rel="stylesheet" href="/modules/volumes/volumes.css">
    {"imports": {"volumes/": "/modules/volumes/", "vue": "/vendor/vue.esm-browser.prod.js"}}

    import volumes from 'volumes/volumes.js';

    <volumes :machines="[{name: 'phone', title: 'phone', base: '/api/v1/remotes/phone/volumes', offline: false, user: 'user'}]"/>

Its list is the page's `items_view.js`, given the volumes of every machine, which draws the
columns the manifest names, and the machine each is on beside them.

## In serviceman

- the Storage page lists them under the folders, for every machine or the one its chips chose,
  and makes and opens one with a typed passphrase
- `src/main/src/routes/handle_control_request.js` sends `/api/v1/remotes/<name>/volumes…` here
  after its own refusals; a key is taken from the machine serviceman runs on, from a page loaded
  from its `localhost` (docker's bridge shows that page from `172.17.0.1`), or over TLS
- the agent's `volume` call goes to its root half, and refuses a key when the agent dialled
  serviceman over plain http; its log names the action and the volume, never the key

## Tests

    node --test modules/volumes/tests/*.test.js tests/agent_volume.test.js
