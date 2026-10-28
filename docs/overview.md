# What serviceman is

serviceman is one Node process in front of your services. It answers on the addresses you
give it, starts the service behind the address at the first request, and stops it again
when nobody visits. A box that would run twenty idle containers runs the two people
actually use.

The starting and stopping happens on a machine with an agent — the box beside serviceman,
or a VPS across the world — and serviceman only talks to agents. It runs no docker and no
program of its own: it holds the doors, the config and the control page.

Nothing else changes for the visitor. The address works, the page opens. Whether the
service was already up, or was started three seconds ago for this very request, is
serviceman's business.

## What it serves

| Kind       | What it is                            | How it is run                                                  |
|------------|---------------------------------------|----------------------------------------------------------------|
| `docker`   | A docker image                        | The agent runs `docker run` on a port docker picks, then `stop` |
| `shell`    | A program on a machine of yours       | The agent runs it and keeps it alive, stopped with its group   |
| `external` | Something already running             | Never started or stopped — an address, and a proxy             |

A `docker` and a `shell` service name the machine they run on — one, a list, or a `#tag` —
and that machine runs the agent. See [Remotes](remotes.md).

The control door also serves `/navplace`: every service that has an address, as a NavPlace
collection, for the desktop app or a page of your own to draw.

Containers are stopped, never removed. A definition that changes replaces its container at
the next start. Containers that already run when serviceman boots are adopted, not started
twice.

## What a request meets

1. serviceman reads the `Host` header and the path, and finds the service. The exact
   hostname wins over `*.example.com`; the longest path prefix wins over a shorter one.
2. A running service gets the request at once.
3. A sleeping service is started. Requests that arrive together start it once.
4. serviceman waits until the port answers — a started container is not a served page.
5. Under 2.5 seconds nobody notices. Above it a browser gets a waiting page that reloads
   itself the moment the service answers; everything else keeps waiting.

Websockets wake a sleeping service the same way and hold their instance for the life of
the socket.

## Addresses

An address is a hostname with an optional path:

    grafana.example.com          one service on its own name
    *.example.com                every name under it
    tools.example.com/pdf        one service on a path of a shared hostname
    tools.example.com/img        another service on the same hostname

With `publish.strip_prefix`, the service behind `/pdf` sees `/report` instead of `/pdf/report` —
apps that expect to live at the root need it.

## Policy

Every service carries the rules of its own life: when to start, when to sleep, how long a
start may take, how long a request may wait.

| Field              | What it does                                               |
|--------------------|------------------------------------------------------------|
| `start`            | At the first request, or with serviceman and stay up       |
| `stop_after_idle`  | Sleep after this much quiet; `false` stays up              |
| `start_timeout`    | How long a start may take before it counts as failed       |
| `request_timeout`  | A request with no answer for this long gets 504            |
| `instances`        | How many copies of the service may run                     |
| `concurrency`      | Requests one instance takes at once; the rest wait in line |
| `warmup`           | When a line is long enough to start another instance       |
| `scale_down_after` | An extra instance with no work for this long is stopped    |

A service with more than one instance is a pool. Requests go to the least busy instance.
A queue that grows warms up the next one, and quiet extras shrink back to the floor while
the service itself stays up.

## The control page

`serviceman.localhost` (and a second port of its own) serves a small Vue page. It shows every
service, its state, its addresses, its policy and its instances, and it does the work:

- **+ Add service** — pick what it is, then fill the cards it cannot do without: what runs,
  where, and its addresses. The name and the port come from the image when left empty, and
  an address with a path strips its prefix. The rest — storage, policy, copies — stays on
  serviceman's defaults until opened.
- **The service page** — its state on top, then one card per part of it: name, what runs,
  where it runs, addresses, storage and secrets, when it runs, copies. **Edit** on a card
  opens it in place; its **Save** writes that change and nothing else.
- **Start**, **Stop** — by hand, whatever the policy says.
- **Logs** — a place kept for what the service itself writes. Not implemented yet.
- **File Manager**, **Shell** — where the service lives. A program's are its folder on the
  machine that runs it: that machine's file manager opened there, and a terminal opened there,
  named after the service and kept running on the machine as its other terminals are. A docker
  service's are inside its running container, `docker exec` in a pane, one container at a time.
  `control.shell: false` takes the shells away.
- **The front page** — every service, one row each, under the machine it runs on: its
  address, kind and state. A filter and the state chips narrow it; the name in the header
  brings it back. The rail holds one row per kind — Services, Remotes, Addresses, Storage,
  Secrets — and **Addresses** lists every name that reaches a service.
- **Map** — all of it as one picture: every address to the service that answers it, every
  service to the machine it runs on (a solid line where it runs now, a dashed one where it
  may), and every machine to Logline where it sends its logs. Pointing at anything lights up
  what it is joined to; clicking opens it. It is at `/map`.
- **Canvas** — every machine on one canvas, drawn as what it is: a server, a laptop or a home
  computer, as its Settings' **Drawn as** says (a server until set). Each has its name and one
  light: green when all is well, amber when its row on Health (Security's looks among them)
  has something to look at, red when something there or a service on it failed, dark while it
  is away. A blue dashed ring turns around the light while work runs on it: a service starting,
  stopping or pulling there, apt installing, a Docker long action, a mend. Drag to move around,
  the wheel, a pinch, **+** and **−** to zoom, **Fit** for every machine in view; a machine
  dragged stays where it is put, for every page (`canvas.json` in the state folder, `PUT
  /api/v1/canvas/machines/<name>` with `{x, y}` or `{kind}`); a click or Enter opens it. It is
  at `/canvas`.
- **Ctrl K** — finds anything by any word it carries: a service, a remote, an address, a
  folder.
- **The pencil** — the config file in a code editor, for the edge cases the form leaves
  out.

Every change is written to the config file and applied at once. A service that did not
change keeps running untouched. Nothing waits for a restart except `listen` and `control`.

## The log

Every line has the same shape — `[time][group_uid][sender] details` — and it lands in
`data/logs/<yyyymmdd>.log`, on the control page and on stdout, all three:

    [2026-08-21T16:57:07.113Z][cqhldlq3xclh][request_begin] GET /hello {"from":"","host":"whoami.test","ip":"203.0.113.9"}
    [2026-08-21T16:57:07.115Z][c8pox602ru6x][group_spawn] parent=cqhldlq3xclh
    [2026-08-21T16:57:08.201Z][c8pox602ru6x][docker_run] service=whoami image=demo/whoami
    [2026-08-21T16:57:08.269Z][cqhldlq3xclh][request_end] 200 0.156s whoami#1

Work that causes other work keeps the trace of what caused it, so one grep answers *why did
this container start* — and one grep of a sender answers *how often does this happen*. See
[The log](logs.md). `SERVICEMAN_LOG_DIR` moves the folder; `SERVICEMAN_LOG_DIR=none` turns
the file off.

## What it is not

- Not a load balancer for one big app. It is a door for many small ones.
- Not a TLS terminator. Put caddy or nginx in front and keep the `Host` header.
- Not a container builder. Images are pulled and run, never built.
- Not a scheduler. A service runs where you put it: the remote you name by hand, or the
  first online machine of the list you wrote. Nothing is placed for you, and nothing moves
  on its own.
- Not a runner. serviceman itself starts no container and no program: the agent on the
  machine does, and serviceman asks it over the link.

## The shape of the code

Plain CommonJS, one exported function per file, no framework. `node src/main` reads the
config, opens the doors and starts the reaper. The control page is Vue 3 and the Ace
editor, both vendored into `src/main/public/vendor/` — no build step, edit and refresh.

    src/agent/        the agent that runs on every machine that carries services, bundled into one file — `node src/agent`
    src/helpers/      generic common helpers, one function each
    src/main/         serviceman itself: both doors, :3000 and :3001 — `node src/main`
    src/main/public/  the control page, no build
    src/main/skins/   the looks of the pages, one folder per skin
    tests/            node --test, a docker stand-in in tests/bin/docker

The tests run without docker: `tests/bin/docker` answers like the real command and spawns
small HTTP servers, and every test that starts a service spawns a real agent against it, so
the whole life of a service — cold start, proxy, idle stop, restart, adoption, pool
scaling — is tested end to end, over the link.
