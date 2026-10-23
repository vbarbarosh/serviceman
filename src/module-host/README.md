# module-host

serviceman's modules on this computer, in a page of their own: no serviceman, no image and no
agent to install. The ServiceMan agent's own code runs inside module-host, joined to it by a
link of its own, and each module is answered through the same calls, streams and helpers
serviceman uses for a machine whose agent dialled in. The work is done as the user who started
module-host.

It loads every module: **Processes**, **Disks**, **Packages**, **Docker**, **Files**,
**Terminal**, **Firewall** and **Volumes**.

## Run

    bin/run-local

or, the same, `node src/module-host/index.js`. It prints the address to open,
`http://localhost:3002/?key=…`: the key puts a cookie in the browser, and the page then opens at
http://localhost:3002/. It needs node and the packages (`bin/run-local` installs them when
missing).

- `PORT`: where it listens, 3002 by default; always on 127.0.0.1.
- `SERVICEMAN_AGENT_DIR`: where the agent keeps what it keeps, `~/.local/state/module-host` by
  default: the page's key, `page.key`, and the kept terminals, which go on running when
  module-host stops and are there again when it starts.
- `UFW`: another ufw, such as the module's fake one:

      UFW="node modules/firewall/tests/fake_ufw.js" FAKE_UFW_STATE=/tmp/ufw.json bin/run-local

## What each module needs

| Module | Needs on this computer |
|---|---|
| Processes, Disks, Packages | `ps`, `df`, `dpkg`, as the agent reads them on a machine |
| Docker | a docker socket the user can reach (`/var/run/docker.sock`, or `DOCKER_HOST`) |
| Files | nothing: the user's own files, from the home folder |
| Terminal | `python3`, which holds each kept terminal |
| Firewall | `ss` for the ports; ufw as root (below) |
| Packages' upgrade, Volumes | root (below) |

**Work that wants root** goes where the agent sends it on a machine: to its root half when this
computer has one (it answers at `/run/serviceman-root.sock`; serviceman's Install tab installs
it, ticked "give it a root half too"), and otherwise to `sudo -n`, which answers only where a
sudoers line lets it. For ufw, one line:

    echo "$USER ALL=(root) NOPASSWD: /usr/sbin/ufw" | sudo tee /etc/sudoers.d/module-host-ufw

Volumes take the root half only: cryptsetup and mount behind a sudoers line would be root by
another name.

## Who may ask

It listens on 127.0.0.1 only, and answers only its own page, in the browser of the user who
started it:

- the API and the WebSockets want the key's cookie: 127.0.0.1 is every user's of this computer,
  and behind it are a shell, the files and docker as this one;
- a request whose Host is not `localhost` or `127.0.0.1` is refused (a site that points a name
  of its own at 127.0.0.1);
- a change, and a WebSocket, must carry the Origin of that page (another site open in the same
  browser).

## Layout

    index.js                 the server, PORT; the agent's folder
    src/machine_host.js      this computer as the modules' host: serviceman's `app` and the remote
    src/machine_link.js      the agent's code in this process, joined by a socket file of its own
    src/modules_served.js    the modules: each one's page half, its manifest, and its API with what it is given
    src/request_answer.js    the page, /api/modules, /api/v1/modules, /api/v1/streams, /api/machine, /api/<module>…, the files
    src/upgrade_answer.js    the WebSockets: a kept terminal joined, a shell in a container
    src/request_allowed.js   only this computer's own page, with the key
    src/page_key.js          the key, kept in the agent's folder
    public/module_host.js    the page: this computer's name, the modules, the one open

A module is added in two places: its entry in `src/modules_served.js` (where its page half is,
its manifest, and its API with what this computer gives it), and what its component is given in
`MODULE_PROPS` in `public/module_host.js`.
