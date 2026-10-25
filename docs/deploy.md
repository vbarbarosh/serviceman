# Deploy

## Files

The control page is plain files in `public/` — Vue 3, xterm, the Ace editor and CodeMirror
are vendored, nothing is built at run time. After `npm install`, run `bin/vendor` once to
copy them out of `node_modules` into `public/vendor/` (the copies also live in the repo);
CodeMirror comes as many small modules, so `bin/vendor` bundles it into one file with esbuild.

## Hostnames

Every service needs a name that resolves to the serviceman host. One wildcard record is
usually enough:

    *.example.com.    A    203.0.113.10

`*.localhost` resolves to 127.0.0.1 on most systems, which is why the config in the repo
uses it.

## Port 80

Ports below 1024 need a privilege. Pick one:

    setcap 'cap_net_bind_service=+ep' $(which node)     # let node bind 80 directly
    # or keep 8080 and put nginx, caddy or a tunnel in front

## TLS

serviceman speaks plain HTTP. For HTTPS, put a TLS terminator in front of it (caddy, nginx,
cloudflare) and send everything to serviceman with the `Host` header untouched. serviceman adds
`x-forwarded-for`, `x-forwarded-proto` and `x-forwarded-host` for the service behind it.

## Docker

serviceman itself never calls docker. The agent on each machine does — including the machine
serviceman runs on, if it is to carry services — so it is the agent that needs an account in
the `docker` group, or `DOCKER_HOST` pointing at a socket it may use.

### serviceman in a container, with tailscale inside

`Dockerfile` builds serviceman together with a tailscale agent, for a machine that should carry
neither. There is no docker command in the image: the containers of a service are started by
the agent on the machine that is meant to carry them.

    bin/build            # docker build -t serviceman .
    bin/run              # the repo as the source, on the machine's own network, in front of you

`bin/run` is the one to work with: `--rm`, no daemon, the image as `bin/build` built it, with
this repo's `data/` mounted at `/app/data`, so its config and its logs stay between runs. The
image holds node, tailscale, the packages and the source: change any of those and it wants
`bin/build` again. `TS_AUTHKEY` is taken from your environment when it is set.
`demos/docker-compose.yml` is the same image left running on a machine instead.

**The container keeps a network of its own.** Two ports are published on the machine's
loopback and nothing else — 3000 for the services, 3001 for the control page — so nothing is
open on the machine's public address. tailscaled joins the tailnet from inside and hands the
connections it receives to 127.0.0.1 *in the container*, so a tailnet peer reaches serviceman
and nothing else on the machine. `--net host` would make that loopback the machine's own, and
then any port on the machine would be a port on the tailnet.

**Its config is `data/serviceman.json`**, on the volume beside the logs and the secrets.
`bin/configure` writes a starting one when there is none, and a first run of the image does the
same when it finds none, with the two things below set; the file belongs to whoever owns
`data/`, not to root, and it is yours from then on. A path in it means what it means on the
machine that carries the service: serviceman in here runs nothing itself.

**The tailnet is a way in, and a proxy is the way out.** tailscaled runs in userspace mode, so
nothing serviceman dials goes through it: from in here a tailnet address is not routed and a
tailnet name does not resolve. tailscaled also runs a proxy on the container's own
`localhost:1055`, published nowhere, and `TAILNET_PROXY` points serviceman at it. Its calls to
Logline go that way, so Logline's address may be a tailnet IP or a `*.ts.net` name. Nothing else
serviceman does uses it.

**Each build takes the newest tailscale.** The binaries come from the `tailscale/tailscale:stable`
image, and `bin/build` builds with `--pull`, so every build fetches the newest stable release,
and the newest `node:24-alpine`, for the machine's own architecture.

Three things follow from that network, and the image handles all three:

**A published port does not arrive on the container's loopback.** So both doors bind
`0.0.0.0` inside, where docker forwards to. What may reach them is decided outside, by
`-p 127.0.0.1:...` on the machine.

**The control page is `exposed`.** A forwarded request is a stranger to serviceman, however
local it was on the machine, and without `exposed` the control page answers 404 to strangers.
Its wall is the `127.0.0.1` in `-p 127.0.0.1:3001:3001`. Take `exposed` out of the config to
have the control page over the tailnet only — those connections *do* arrive on the loopback in
here, so they are let in.

**An agent on the machine reaches it through a socket, not a port.** The socket is a file, and a
file in the container is nowhere — so mount the folder it should live in and point
`control.socket` at it:

    docker run … -v $HOME/repos:/repos …            # added to the docker run in bin/run
    "control": {"socket": "/repos/serviceman.sock", "socket_mode": "0666"}

Then an agent anywhere on that machine — in another container with the same folder mounted, or
on the machine itself — dials `--url unix:///…/serviceman.sock` and no port is opened for it.
The socket is made by root inside the container, so `0600` would refuse an agent running as
anybody else; the folder above it is the real gate, and `~/repos` is not a folder strangers walk
through. That agent is what carries the services of this machine — serviceman in here starts
nothing itself, so it needs no docker socket and no docker command.

| Volume                | What is in it                                             |
|-----------------------|-----------------------------------------------------------|
| `/app/data`           | `serviceman.json`, the config; the logs, tailscaled's in `tailscaled.log`; the secrets |
| a folder of yours     | Where the control socket lands, for agents on the machine |
| `/var/lib/tailscale`  | The tailscale identity of this machine. Keep it.          |
| `/var/run/serviceman` | The control socket, for an agent on the machine itself    |

| Variable                 | What it does                                                             |
|--------------------------|--------------------------------------------------------------------------|
| `TS_AUTHKEY`             | Joins the tailnet with no hands. Without it, `docker logs` has the link. |
| `SERVICEMAN_OWNER_TOKEN` | The owner's token of the control page, instead of `data/owner.token`.    |
| `TS_HOSTNAME`            | The name on the tailnet. Default `serviceman`.                           |
| `TS_SERVE`               | `1` puts `tailscale serve` in front, so the address is **https**.        |
| `TS_EXTRA_ARGS`          | More for `tailscale up` — `--advertise-tags=tag:server`, and the rest.   |

A first run writes `data/serviceman.json` if there is none; after that the file is yours and
nothing here writes over it. Every start reads it and says what will not work in a container —
a door on the loopback, a control page that is not `exposed`, a control socket nothing outside
can open.

**One thing worth deciding.** The control page answers on the tailnet like everything else, so
everyone on your tailnet can open it — `"control": {"port": null}` leaves it on its socket only.
The services of the machine itself are the **agent**'s to run: it needs only node and docker,
and it dials the control socket in `/run/serviceman`.

## systemd

    [Unit]
    Description=serviceman
    After=network.target

    [Service]
    WorkingDirectory=/srv/serviceman
    ExecStart=/srv/serviceman/bin/run
    Restart=always
    User=serviceman

    [Install]
    WantedBy=multi-user.target

`Restart=always` is safe: serviceman adopts the containers that are already running, through
the agents that dial in again.

## What is reachable, and by whom

Nothing is open until the config opens it.

| Door                               | Bound to      | Who is answered                                |
|------------------------------------|---------------|------------------------------------------------|
| The services, `listen`             | `127.0.0.1`   | Anyone who reaches the address.                |
| The services, `listen.socket`      | a file        | Anyone who may open the file.                  |
| The control page, `control.socket` | a file        | Anyone who may open the file, mode `0600`.     |
| The control page, `control`        | `127.0.0.1`   | This machine only, over either port.           |
| The remote link, `/api/v1/remote`  | with `listen` | Anyone holding that remote's token.            |
| The agent file, `/api/v1/agent.js` | with `listen` | Anyone. It is public code and holds no secret. |

To serve the public, widen the service port and put TLS in front:

```json
"listen": {"host": "0.0.0.0", "port": 8080}
```

The control page stays closed to the outside even then. It starts and stops services, edits
the config, holds the remote tokens and **opens a shell on every machine with an agent**, so it
answers the machine serviceman runs on and nobody else. Asked from anywhere else it is a 404,
over either port, exactly like an address no service claims.

### A token for every caller

Even on this machine, and through the control socket, nothing gets in without a token:

- **The owner's token** may do everything. serviceman makes it the first time it starts and
  keeps it in `data/owner.token`, readable by you alone; `bin/owner-token` prints it.
  `SERVICEMAN_OWNER_TOKEN` gives one of your own instead, and then no file is written. The page
  asks for it once and keeps it in a cookie only its own requests carry: never sent on to a
  service, and marked `Secure` when the page came over https; **Sign out** is
  `DELETE /api/v1/session`.
- **An agent's token** is made on the page's **Tokens** tab, for an agent or a program: a
  label, the machines it sees, and its rights on them. The reads are `status`, `metrics`,
  `processes`, `ports`, `disks`, `packages` and `containers`. `files` is the file manager of
  its machines within **its folders** (`~/visual-agency`, `~/notes`, the same on each, `~` that
  machine's home; the first is where it starts): the machine's agent resolves every path, links
  included, and refuses whatever lies outside them, so neither `../` nor a link that leads out
  gets past it. A folder not there yet lists empty and is made by the first write into it.
  Copies between machines stay the owner's. `terminals` lists, makes, joins, signals and ends the kept terminals of its
  machines, a shell on each of them that goes anywhere, so treat such a token like an ssh key
  to them. `versions` sends a new version of an app folder on its machines, as a zip
  (`PUT /api/v1/services/<name>/zip`,
  [A new version of an app folder](config.md#a-new-version-of-an-app-folder)): what it sends
  runs there as the app, so it is a key to those apps; **Apps** keeps it to the app folders
  ticked, and a service's page makes one for that service alone, **Make a token for …**, with
  the curl line beside it. It is shown once, and only its hash is kept, in
  `data/control_tokens.json`. It never touches the config, a secret, another
  machine, or a service but the one it sends a new version to, and opens no other shell. **Edit…** changes its label, machines (**every
  machine**, those added later too, is one tick), rights, folders and apps in place, the token
  staying the same; **Rotate…** gives it a new value, shown once, the old one refused at once;
  **Revoke…** ends it.

A caller sends its token with every request:

    curl --unix-socket data/serviceman.sock -H "Authorization: Bearer $TOKEN" http://localhost/api/v1/status

An agent's status is its own: its machines and what runs on them, nothing of the config. Every
route says which right it needs in one table (`control_route_right.js`); a route that says
none, one added later included, is the owner's alone. The agent file, the installer and an agent
dialling in with its remote token need no token of the control door.

Reach it from your laptop with an SSH tunnel:

    ssh -L 8081:127.0.0.1:8081 you@the-host

If you would rather put your own wall in front — an authenticating proxy, a VPN — say so:

```json
"control": {"exposed": true, "names": ["ops.example.com"]}
```

`exposed` lets other callers in; `names` adds the hostnames that proxy asks by. serviceman
prints a line at startup when `exposed` is on, so it is never a surprise. Without it, a
hostname pointed at 127.0.0.1 by someone else's DNS gets nowhere either: the control page
answers its own names only.

Set `"control": {"host": null, "port": null}` to switch it off completely, or
`"control": {"shell": false}` to keep the page and close the shell door alone.

## The control API

Everything the control page does, it does through these. They all answer this machine only,
they all want a token (above), and they all live under `/api/v1/` — on the control port, or on
the control hostname over the service port.

| Call                                     | What it does                                    |
|------------------------------------------|-------------------------------------------------|
| `GET /api/v1/status`                     | Every service, every remote, and the log.       |
| `GET /navplace`                          | Every service with an address, as a NavPlace collection. |
| `GET /api/v1/config`                     | The config file as text, with its hash.         |
| `POST /api/v1/config/check`              | Read a config and say what is wrong with it.    |
| `POST /api/v1/config`                    | Write it, and apply it to the running services. |
| `POST /api/v1/services`                  | Add a service.                                  |
| `PUT /api/v1/services/<name>`            | Reshape one.                                    |
| `DELETE /api/v1/services/<name>`         | Take one away.                                  |
| `POST /api/v1/services/<name>/start`     | Start it now.                                   |
| `POST /api/v1/services/<name>/restart`   | Stop it, then start it again, as one ask.       |
| `POST /api/v1/services/<name>/stop`      | Stop it now.                                    |
| `POST /api/v1/services/<name>/update`    | Fetch the program again, then start it again.   |
| `POST /api/v1/services/<name>/pull`      | Fetch the image again; remake what runs on it.  |

| `GET /api/v1/image-ports?image=&remote=` | What ports an image says it exposes, asked of that machine's docker. |
| `POST /api/v1/remotes`                   | Add a remote.                                   |
| `PUT /api/v1/remotes/<name>`             | Reshape one.                                    |
| `DELETE /api/v1/remotes/<name>`          | Take one away, unless a service names it.       |
| `GET /api/v1/shell?service=&slot=`       | A websocket into a container.                   |

Two doors under the same prefix are not part of it: `GET /api/v1/agent.js` hands the agent to
anyone who asks, and `GET /api/v1/remote` is where an agent dials in with its token.

## What a visitor learns

A visitor whose service is down gets a page that says it did not answer, and nothing else —
no ports, no container names, no docker output, no remote names. The reason goes to the log
and to callers from this machine. The one address a visitor may poll,
`/__serviceman__/status.json`, answers the phase and how far a start is, and of a failure the
same short line as the page, with no output of the program; the reason and the output go to
callers from this machine, as the page's do.
