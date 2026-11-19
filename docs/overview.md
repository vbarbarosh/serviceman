# What serviceman is

serviceman sets up the machines you give it, and their agents serve. Each machine, the box
beside serviceman or a VPS across the world, runs an agent that dials serviceman and is told
what to run there and which names its door answers. The agent answers those names itself: it
starts the service behind a name at its first request, asks the wall in front of it, and has it
stopped again when nobody visits. A box that would run twenty idle containers runs the two
people actually use.

serviceman runs no docker and no program of its own: it holds the config, the control page and
the tables it writes for the machines' doors. The machines' agents reach each other directly,
so no request waits on one place, and there can be as many machines as you like. A few things
still come through serviceman's own door ([What a request meets](#what-a-request-meets)).

Nothing else changes for the visitor. The address works, the page opens. Whether the
service was already up, or was started three seconds ago for this very request, is
the agent's business.

## What it serves

| Kind       | What it is                            | How it is run                                                  |
|------------|---------------------------------------|----------------------------------------------------------------|
| `docker`   | A docker image                        | The agent runs `docker run` on a port docker picks, then `stop` |
| `shell`    | A program on a machine of yours       | The agent runs it and keeps it alive, stopped with its group   |
| `external` | Something already running             | Never started or stopped — an address, and a proxy             |
| `files`    | A folder of files: a page, an app     | Served by serviceman itself; nothing runs                      |

A `docker` and a `shell` service name the machine they run on — one, a list, or a `#tag` —
and that machine runs the agent. See [Remotes](remotes.md).

The control door also serves `/navplace`: every service that has an address, as a NavPlace
collection, for the desktop app or a page of your own to draw.

Containers are stopped, not removed, unless you remove one on the Docker tab. A definition
that changes replaces its container at the next start. Containers that already run when serviceman boots are adopted, not started
twice.

## What a request meets

serviceman sets up; the machines serve. A name that comes in at a machine's door is answered by
that machine's agent, by the table serviceman wrote for it and the agent keeps on its disk:
serviceman is in no step of it, and the door goes on with serviceman away. The agent asks the
wall in front of the service, wakes it when it is asleep, waits for it to answer (up to a
minute), and carries the request straight to it, or straight to the agent of the machine it
runs on; it tells serviceman afterwards that the service ran.

serviceman's own door answers what still comes through it: a name at serviceman's own address,
a folder of files, an app on a socket file, a name a machine's table does not have, and a door
rule of `*`, whose app serviceman looks up. There:

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

The **Addresses** page lists every name a request arrives on, each app's own port among them, with
its whole way: who opens it, whether it does, and where it is set.

| Who opens it  | How it is found                                         | ✓ when                                        |
|---------------|---------------------------------------------------------|-----------------------------------------------|
| this computer | a `.localhost` name, by itself                          | always                                        |
| your tailnet  | an app's port on serviceman's tailnet name              | the port listens and tailscale names serviceman |
| your tailnet  | a name under the apps domain, by serviceman's DNS       | this computer's DNS leads it to serviceman    |
| anyone        | its own DNS, to serviceman or to a machine's door       | its DNS leads to that machine's address       |

A name is looked up as this computer's DNS answers it, every 30 seconds while the page is open.
✗ is what was measured not to work (no DNS answer, another program on the port, `apps.dns` not
set), said under it; ? is a DNS answer that leads elsewhere, said with both addresses: a cloud
machine's public address is often on none of its own interfaces, so serviceman does not call it
broken. **Set in** opens where the name is written: an app's **Settings** on **Apps**, a
service's settings, the config at its `apps` domain, or **Doors**.

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

- **+ New service** — one question a screen, or all of them on one page: what it is, where it
  comes from, the machine, its address and who may open it, then Check. The name and the port
  come from the image when left empty, and an address with a path strips its prefix. The rest
  — storage, policy, copies — stays on serviceman's defaults until changed on Check.
- **The service page** — its state on top, then one card per part of it: name, what runs,
  where it runs, addresses, storage and secrets, when it runs, copies. **Edit** on a card
  opens it, and its **Save** writes that card at once; **Cancel** puts it back.
- **Start**, **Stop** — by hand, whatever the policy says.
- **Logs** — a place kept for what the service itself writes. Not implemented yet.
- **Files**, **Shell** — where the service lives. A program's are its folder on the
  machine that runs it: that machine's file manager opened there, and a terminal opened there,
  named after the service and kept running on the machine as its other terminals are. A docker
  service's are inside its running container, `docker exec` in a pane, one container at a time.
  `control.shell: false` takes the shells away.
- **The front page** — every service, one row each, under the machine it runs on: its
  address, kind and state. A filter and the state chips narrow it; the name in the header
  brings it back. **Addresses** lists every name that reaches a service, with who opens it and
  whether it does.
- **The crumbs** — on top of every page, where you are: `Remotes ▾ › vps1 › Settings`. The
  first is a menu of the categories, Services, Databases, Remotes, Addresses, Shared folders,
  Secrets and Tokens, each with its count, then **All categories**: a tile for each of the 22,
  with what it is for. Every other crumb goes back up to it; the address follows them, so a
  reload or a link lands on the same place.
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
