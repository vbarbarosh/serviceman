# Config

serviceman reads one JSON file, `data/serviceman.json`: `bin/configure` writes a starting one
when there is none, and `bin/run` hands it to the image. Every relative path inside the file is
read against the folder the file lives in. Run on the machine itself, `node src/main` takes the
path from the command line, from `$SERVICEMAN_CONFIG`, or it is `./serviceman.json`.

    node src/main                                # ./serviceman.json
    node src/main /etc/serviceman.json
    node src/main data/serviceman.json --check   # read the config, report what is wrong, exit

`--check` refuses a config that would only fail at the first request: an unknown type, a
missing image, a hostname written twice, a duration nobody can read.

## Edit from the control page

Services are created and reshaped on the control page itself. **+ Add service** is a short
form for the two common kinds. **A docker image** asks for the image; the name comes from it
and the port defaults to the one the image names, or 80. **An app folder** asks for the folder
on the machine: it must hold `bin/run`, which serves the app on the port it finds in `PORT`,
and may hold `bin/configure`, which then runs once before the first start. A `.zip` of such a
folder, picked or dropped on the form, is read in the page and its files are sent on **Create**
to a new folder on the machine, with their modes, so the machine needs no `unzip`. Unless
another is typed, that folder is `services/<name>` in the agent's own folder, where everything
the agent installs lives (`~/serviceman-agent/services/<name>` for an agent installed as its
user); it stays there when the service is removed, with the app's `data/`. The name comes from the folder or the zip, and the port is the
first one from 8080 that no other program is given and the machine does not listen on. Both get the machine they run on and an address made of their
name. **All settings…** opens every card, with what the short form filled in, for a program of
another shape or something already running; an address with a path strips its prefix. A service's own
page is the same cards, each with **Edit** — addresses, image, storage, environment, the
whole policy. A card's **Save** writes the config file and applies it at once; only the
fields you fill land in the file. **Remove…**, the last card, takes a service out of the
config — anything running keeps running.

Everything in this file has a place on that page: **Runs on** is a list of machines and
`#tags` in the order they are tried, **Follow the load** turns the autoscaler on under
**Copies**, the checkbox beside the image fetches it before the first visit, a remote's **Tags**
sit in its form, and **Let machines join** on the Remotes page holds the join token and the tags a
machine may claim.

For the edge cases the pencil opens the config file in a code editor. **Check** reads the
text and reports what is wrong without touching anything. **Save** writes the file and
applies it the same way:

- A service whose definition did not change keeps running untouched.
- A new or changed service starts fresh; a changed one gets its container replaced at the
  next start.
- A removed service is no longer served, but anything running keeps running.
- `listen` and `control` are saved but wait for a serviceman restart.

A save is refused while the file on disk differs from what the editor loaded — someone
edited it in parallel. Load it again and repeat the edit.

## The whole file

```json
{
    "listen": {"host": "127.0.0.1", "port": 8080, "socket": null},
    "control": {"host": "serviceman.localhost", "port": 8081, "bind": "127.0.0.1", "socket": null},
    "defaults": {"start": "on_demand", "stop_after_idle": "10m", "start_timeout": "120s"},
    "remotes": [],
    "services": []
}
```

| Field        | Default             | What it is                                                     |
|--------------|---------------------|----------------------------------------------------------------|
| `listen`     | `127.0.0.1:8080`    | Where the services are served: a port, a socket file, or both. |
| `control`    | see below           | Where the control page is.                                     |
| `defaults`   | see the table below | The policy every service starts from.                          |
| `remotes`    | `[]`                | The machines that carry services. See below.                   |
| `logline`    | none                | Where the remotes send their logs. See **Logline** below.      |
| `load_tests` | `[]`                | What k6 is sent at. See **Load tests** at the end.             |
| `services`   | required            | The list below.                                                |

### A socket file instead of a port

Either door can be a file on disk as well as a port:

```json
"listen": {"host": "127.0.0.1", "port": 8080, "socket": "run/services.sock"},
"control": {"host": "serviceman.localhost", "port": null, "socket": "run/control.sock"}
```

The services are answered by hostname through the file exactly as through the port:

    curl --unix-socket run/services.sock http://grafana.example.com/

A socket file needs no port and no address of its own, and `ssh -L /here.sock:/there.sock` moves
it between machines — so the control page, or a whole set of services, can be reached from your
laptop with nothing open on the box, and an agent can dial in the same way
(`--url unix:///run/control.sock`). It is also the answer to fronting something with `socat`:
serviceman speaks the socket itself.

Who may open the file is who may knock, so `socket_mode` is the whole of its security — `0600`
by default, the owner and nobody else. A stale file from a serviceman that died is taken over; a
file something still answers on is left alone and serviceman refuses to start.

**Both doors are on the loopback until you say otherwise.** `listen.host` is the address the
services are served on; nothing outside the machine reaches them until it is widened, usually
to `0.0.0.0` behind a TLS terminator.

`control.host` is a hostname on the service port; `control.port` is a second port that serves
the control page and nothing else. Set either to `null` to close that door.

| Field         | Default     | What it is                                                                   |
|---------------|-------------|------------------------------------------------------------------------------|
| `host`        | see above   | The hostname that reaches the control page over the service port.            |
| `port`        | `8081`      | A port of its own for the control page. `null` closes it.                    |
| `bind`        | `127.0.0.1` | The address that port is bound to.                                           |
| `socket`      | none        | A socket file the control page also answers on. See below.                   |
| `socket_mode` | `"0600"`    | Who may open that file, and so who may reach the page through it.            |
| `exposed`     | `false`     | Answer callers other than this machine. See below.                           |
| `names`       | `[]`        | Other hostnames the control page may be asked by, when something renames it. |
| `shell`       | `true`      | `false` keeps the page and takes the **Shell** button away.                  |

The control page reads and writes the config, opens shells inside containers and holds the
remote tokens. So it answers **the machine serviceman runs on** and nobody else: asked from
anywhere else, over either port, it is a 404 like any unknown address. Reach it through an ssh
tunnel, or set `"exposed": true` and put your own wall in front — serviceman says that out
loud at startup when you do. Even then every caller brings a token: the owner's, which
`bin/owner-token` prints, or an agent's made on the **Tokens** tab
([A token for every caller](deploy.md#a-token-for-every-caller)).

`control.names` only widens which hostnames it answers by, never which callers. A caller that
is not this machine is still refused.

The **Shell** of a container asks the docker socket on the machine that runs it, through the
agent's link; the agent says where that socket is.

## Remotes

A remote is a machine that carries services — a VPS, or the very machine serviceman runs on.
It runs the agent, which dials this host and waits for orders; serviceman itself starts nothing
and runs no docker. **+ Add remote** on the control page writes this block for you. serviceman
never dials out, so the machine needs no open port, no public address and no key of yours.
[Remotes](remotes.md) has the whole story — installing the agent, a systemd unit, and what the
token buys.

```json
"remotes": [
    {"name": "vps1", "title": "Example VPS", "token": "0c0f…a91b", "tags": ["gpu", "eu"]}
]
```

| Field     | What it is                                                                            |
|-----------|---------------------------------------------------------------------------------------|
| `name`    | Lowercase letters, digits, `-` and `_`. The agent dials in under this name.           |
| `title`   | The name on the control page. Optional.                                               |
| `token`   | The secret the agent proves itself with. At least 16 characters.                      |
| `tags`    | What this machine is, for a service that asks for a kind of machine.                  |
| `machine` | Written by serviceman when a machine adds itself; see **A machine that adds itself**. |
| `logs`    | `"all"` sends every container's output to Logline; `"off"`, the default, sends none. See **Logline**. |
| `log_dirs` | Folders whose files go to Logline as well, while `logs` is `"all"`: `[{"path": "/var/log/nginx/*.log", "service": "nginx"}]`. |

The token lets another machine run programs for you, so make it a real one:

    openssl rand -hex 32

On the other machine, with node installed:

    serviceman-agent --url https://serviceman.example.com --token 0c0f…a91b

The agent says what the machine has — cpu, memory, free disk, docker version — and repeats
the numbers that move every 5 seconds, from servermon's last line. This host pings it every 30 seconds for the delay,
and sends a megabyte there and back every ten minutes for the speed. A link that stops
answering is dropped; the agent dials in again, waiting 1s, then 2s, up to 30s.

A remote that keeps its name and its token keeps its link when the config is applied
again. Changing either drops the link, and the agent comes back with the new one.

### Forwards

A port or a socket file of one machine, brought to another, as `ssh -L` brings one: `from` is
where the service is, `to` is where it shows up. The machine at `to` listens; each connection
rides its link to serviceman and the other machine's link to `from`. No ssh and no key.
**Forwards** on the Doors page writes this list for you.

```json
"forwards": [
    {"label": "Loki on vps1", "from": {"remote": "vps1", "port": 3100}, "to": {"remote": "laptop", "socket": "~/repos/loki.sock"}}
]
```

| Field         | What it is                                                                         |
|---------------|------------------------------------------------------------------------------------|
| `label`       | Any text of one line, up to 100 characters, one per forward. A config from before labels has `name`. |
| `from.remote` | The machine the service is on.                                                     |
| `from.port`   | A port there, on its loopback unless `from.host` names an address it reaches.      |
| `from.socket` | Or a socket file there.                                                            |
| `to.remote`   | The machine it shows up on, which listens.                                         |
| `to.here`     | Or `true` in place of `to.remote`: it shows up on serviceman itself, which listens. |
| `to.socket`   | A socket file there, `0600`: only the agent's user may open it. `~/` is that user's home. On serviceman itself, a path inside its state dir, written from it: `sockets/loki.sock`. |
| `to.port`     | Or a port on its loopback, `127.0.0.1`, and nowhere else.                          |
| `off`         | `true` sets it aside: written down, and not listened for.                          |

Both machines run the agent, version 1.15 or newer; one that shows up on serviceman itself
needs it only on `from`. [Remotes](remotes.md#a-port-or-a-socket-from-one-machine-to-another)
says what happens while one of them is away, and [onto serviceman itself](remotes.md#a-forward-onto-serviceman-itself)
where its socket lands.

### Logline

[Logline](../logline/) is where the remotes' logs go: one endpoint, and ClickHouse behind it.
serviceman says where it is, and asks it for the token each machine sends its lines with.

It is typed in on any machine's **Logs** tab, under **Where Logline is** — the endpoint, the
admin token and the viewer — and written here; the admin token goes to the Secrets library.

```json
"logline": {"endpoint": "http://logline:3000/lines", "admin": "logline"}
```

| Field      | What it is                                                                                 |
|------------|--------------------------------------------------------------------------------------------|
| `endpoint` | Where the machines POST their lines.                                                       |
| `admin`    | The name of a secret in the **Secrets** library holding Logline's `ADMIN_TOKEN`. The value is never in the config. |
| `ui`       | Where Logline's viewer is, such as `http://logline:8081/`. Optional: the **Logline** button on a machine's **Logs** tab opens it. |

Logline itself runs on one machine, as a compose project. serviceman carries its files in its
image and keeps that machine's copy the same: **Update Logline** on Logline's page compares
every file by sha256, puts the ones that differ in the project's folder, runs
`docker compose up -d --build` there, and starts again each service that mounts a file that was
put (a file is replaced whole, and a container keeps the old one until it starts again). The
machine is the one the service named `logline` is on, and the folder is the one its containers
were started from; `.env` and what Logline keeps are the machine's and stay. Logline has to be
started there once by hand, the first time.

A remote with `"logs": "all"` is told the endpoint and a token of its own. Logline binds that
token to the machine's addresses, which the agent says when it dials in; the token works from
those addresses and nowhere else. serviceman keeps the tokens it was given in
`data/logline_tokens.json`, mode 600, and takes a token back when its remote leaves the config.

The moment a machine is switched on is its **floor**: every line from then on is kept, and none
from before. The agent writes the floor down before anything else, in
`<agent folder>/logline/settings.json`, so a restart does not move it. Switching `logs` on or off
is told over the link the machine is on; it does not dial in again. The machine's **Logs** tab
switches it, and says where its lines go, from when, how many went and how many wait, and why
the last telling failed if it did.

A machine switched on follows every container it has — the ones there, the ones stopped, and
every one started later — from its floor, into a spool on its own disk, and sends the spool to
Logline in batches. A batch leaves the spool only when Logline has it; while Logline cannot be
reached the spool grows, up to a gigabyte or a tenth of the disk, and then the machine stops
reading and docker keeps the lines until there is room. A container labelled `logline=off` is
left alone. The agent's own lines go too — what it connected to, what it was asked, what went
wrong — labelled `service=serviceman-agent`, from the moment collection starts, the lines it
wrote just before that included. How it is kept from losing or repeating a line is in
`notes/logline.md`.

Folders go besides the containers, set on the same tab: a folder — every file in it — or a
folder and a pattern, `/var/log/nginx/*.log`, from `/` or `~/`. Files already there when a folder
is added are read from where they end then; files that appear later are read from their start,
a line at a time as they are written. A file is known by its inode, so logrotate's rename keeps
it, and one truncated in place is read again from its start. Compressed and hidden files are
left alone. Each line is labelled `host`, `service` — the name given, or the folder's own — and
`file`. serviceman's own log is one such folder: its `data/logs`, read by the agent on the
machine serviceman runs on.

## A service on a remote

```json
{
    "name": "grafana",
    "type": "docker",
    "remotes": ["vps1", "vps2"],
    "publish": {"host": "grafana.example.com", "port": 3000},
    "image": "grafana/grafana:latest"
}
```

Every `docker` and `shell` service belongs to a remote: `remotes` lists the machines it may run
on, best first, and one of them is required — a container and a program run where an agent is,
and nowhere else. `"remote": "vps1"` is shorthand for a list of one. An `external` service names
none: it already runs somewhere, on no machine of ours.

When an instance starts, serviceman **reserves** a machine: the first one on the list that is
online, written down before anything is started, and kept for the life of that copy. A machine
that fails to start it is crossed off and the next one is tried. Nothing moves by itself
afterwards — a running instance stays where it is until it stops.

The address stays here; the container runs there. serviceman drives docker over the link —
run, start, stop, inspect, logs — and every request rides back through the same link, so
the remote needs no open port. The visitor sees no difference.

While the agent is away the service is out of reach: what already runs over there keeps
running, and a request gets `remote vps1 is offline — no machine to start it on`. When the
agent dials in again, a container still running is adopted, not started twice, and a service
with `"start": "always"` is started then.

A folder in `volumes` is a folder on the remote's machine, and the agent makes it if it is
missing. Write it as an absolute path — a relative one is read against the config folder on
this host, which means nothing over there.

### A kind of machine instead of one machine

A service names the machines it may run on, best first — and a `#tag` stands for every machine
carrying it:

```json
{"name": "grafana", "type": "docker", "remotes": ["#gpu"], "image": "grafana/grafana:latest"}
{"name": "api", "type": "docker", "remotes": ["vps1", "#eu"], "image": "demo/api"}
```

The second one prefers `vps1` and falls back to anything tagged `eu`.

Tags come from two places: this file, and the machine itself — `serviceman-agent --tag gpu`,
which holds while its link does. So a tag nothing carries yet is not an error at load; the boot
writes `serviceman_tag_nowhere` for it, and the service waits for a machine that answers.

### A machine that adds itself

One secret lets a machine nobody has written down join the fleet:

```json
"join": {"token": "0c0f…a91b", "tags_allowed": ["gpu", "eu"], "name_prefix": "auto-"}
```

```
serviceman-agent --url https://serviceman.example.com --token <the join token> --tag gpu
```

serviceman writes the new machine into this file — with a secret of its own, the tags it was
allowed to claim, and the `machine` it says it is — and it appears on the control page like any
other. The same machine coming back takes its own entry again instead of leaving a dead one.

**A tag in the config is a fact; a tag from a machine is a claim.** A machine may only claim
what `tags_allowed` lists; anything else is dropped and written to the log. The join token is
the trust boundary of the fleet — whoever holds it gets a machine in and the work that goes
with it — so it is a password, not a setting. Leave `join` out and no machine can add itself,
which is the default.

## A service

```json
{
    "name": "grafana",
    "title": "Grafana",
    "type": "docker",
    "publish": {"host": "grafana.example.com", "port": 3000},
    "policy": {"start": "on_demand", "stop_after_idle": "30m", "start_timeout": "90s"}
}
```

| Field     | What it is                                                                       |
|-----------|----------------------------------------------------------------------------------|
| `name`    | Lowercase letters, digits, `-` and `_`. It names the container and the API path. |
| `title`   | The name on the control page and on the waiting page. Optional.                  |
| `type`    | `docker`, `shell` or `external`.                                                 |
| `publish` | Everything outside: the address it answers on, and the port behind it.           |
| `remotes` | The machines it may run on, best first. Required for `docker` and `shell`; none for the rest. |
| `redirect`| Wake it, then send the visitor to this address instead of proxying. Optional.    |
| `policy`  | The fields below.                                                                |

Everything else in a service says how it is run: the image, the command, the address it
already answers on.

### publish

| Field          | What it is                                                                          |
|----------------|-------------------------------------------------------------------------------------|
| `host`         | One address. Use `hosts` for a list. `*.example.com` matches every name under it.   |
| `port`         | The port the service listens on **inside** the container, the stack or the program. |
| `strip_prefix` | The service behind a path prefix sees paths without it.                             |

Exact hostnames win over wildcards. An address belongs to one service only. A program that
answers nowhere has no `publish` at all.

## Addresses with a path

An address is a hostname with an optional path prefix:

```json
{"name": "pdf", "type": "docker", "publish": {"host": "tools.example.com/pdf", "port": 3000}, ...}
{"name": "img", "type": "docker", "publish": {"host": "tools.example.com/img", "port": 3000}, ...}
{"name": "www", "type": "external", "publish": {"host": "tools.example.com"}, "upstream": "127.0.0.1:7000"}
```

One hostname is shared by many services this way. The longest matching prefix wins:
`/pdf/report` goes to the pdf service, `/img/logo.png` to the img service, everything
else to the www service. `/pdf` claims `/pdf` and everything under `/pdf/` — never
`/pdfx`. Without a root service on the hostname, an unclaimed path answers 404.

The service sees the path as the browser sent it: the pdf service above receives
`/pdf/report`. Set `"strip_prefix": true` inside `publish` when the app expects to live at
the root — the same request then reaches it as `/report`.

## An address serviceman keeps for a service

Every service with an address also has one of serviceman's own:

    http://localhost:3000/redir/07c20748/auth/callback
      →  http://google-docs-writer.localhost:3000/auth/callback

Anything asked there is sent on to the service's own address, with the rest of the path and the
whole query untouched, and nothing is started to answer it. The control page shows it on the
service, ready to copy.

**It exists for the rules other people have about addresses.** Google will not take
`http://google-docs-writer.localhost:3000/auth/callback` as an OAuth redirect — over plain http
it accepts `localhost` and `127.0.0.1` and nothing else, and a name under `localhost` is not
`localhost`. It will take `http://localhost:3000/redir/<uid>/auth/callback`, which lands here
and finishes at the service's own name — where the browser has the app's session, which a proxy
would have lost.

The uid follows the service's name and does not change.

## Wake it, then hand the visitor over

```json
{
    "name": "google-docs-writer",
    "type": "shell",
    "publish": {"host": "google-docs-writer.localhost", "port": 8090},
    "cwd": "/home/user/google-docs-writer",
    "argv": ["node", "src/http.js"],
    "redirect": "http://localhost:8090"
}
```

`http://google-docs-writer.localhost:3000/` is then a door, not a proxy: serviceman starts the
program, waits until it answers, and sends the browser to `http://localhost:8090/` with a 302.
The path and the query come along, and the answer is never cached — the door has to be knocked
on every time, or a browser would go straight to a service nobody woke.

This is for an app whose session belongs to an address of its own: a cookie, or an OAuth
callback registered with somebody else, that only works on `localhost:8090`. The door gives it
a name; the app keeps its own origin.

**serviceman sees nothing after the handover.** The visitor talks to the service directly, so
there is no honest idle clock: `stop_after_idle` is off for a handover service unless it asks
for one itself, and then it counts from the last visitor through the door, not from the last
thing the app did.

Whoever sees the traffic can stop the service — and that is the app now. An app that exits by
itself after a quiet spell is marked stopped by serviceman (a clean exit is not restarted), and
the next visitor through the door starts it again.

Only a service that is started for a visitor can carry a `redirect`: `docker`, `shell`.

## type: shell

The agent runs the command on its machine and keeps it alive:

```json
{
    "name": "clickhouse-socket",
    "type": "shell",
    "command": "socat UNIX-LISTEN:/srv/clickhouse.sock,fork,unlink-early,mode=666 TCP:127.0.0.1:8081",
    "policy": {"start": "always", "restart": "always"}
}
```

| Field     | What it is                                                                   |
|-----------|------------------------------------------------------------------------------|
| `command` | The line, run through `/bin/sh -c`. Pipes and redirections work.             |
| `argv`    | The program and its arguments, when no shell is wanted. Wins over `command`. |
| `image`   | The environment its lines run in. Without one they run on the machine itself. |
| `volumes` | The paths it keeps across starts. A service with any runs on one named machine. |
| `user`    | Who it is inside that image: `node:node`, `1000:1000`. Default: whoever runs the agent, by number. |
| `lifecycle` | A line for each moment of its life. See below.                             |
| `cwd`     | Where it runs. The config's folder — or one of serviceman's own when it installs itself. |
| `env`     | Added to the environment serviceman itself has, after `PORT` (below).        |

### The lifecycle of a program

```json
{
    "name": "google-docs-writer",
    "type": "shell",
    "remote": "laptop",
    "publish": {"host": "google-docs-writer.example.com", "port": 8090},
    "command": "bin/run",
    "lifecycle": {
        "install": "git clone https://github.com/vbarbarosh/google-docs-writer . && npm install && bin/configure",
        "update": "git pull && npm install",
        "stop": "bin/flush",
        "uninstall": "dropdb google_docs_writer"
    }
}
```

`command` is what the service **is** — the line that runs and keeps running. The lines in
`lifecycle` are the moments around it, each run in `cwd` through `/bin/sh -c`, on the machine
that carries the program:

| Line        | When it runs                                                                  |
|-------------|--------------------------------------------------------------------------------|
| `install`   | The folder is not there yet. Once — the folder is marked with the line that made it. It always runs in an empty folder. |
| `update`    | The folder is there and the install line has changed. Without it, `install` runs again. |
| `stop`      | Before the program is stopped, for any reason. `SERVICEMAN_REASON` says which. |
| `uninstall` | The service is gone from the config. It is stopped first, then this runs. For what the program made elsewhere — a database, a registration. Not for its folder. |

### Fetching a program again

The program moved on — a commit was pushed — and the config did not change, so serviceman has
no reason to notice. **Fetch again** on its page (`POST /api/v1/services/<name>/update`) is how
you say so: it stops the service if it runs, runs the `update` line, or the `install` line in
an empty folder when there is no `update` line, and starts it again if it was running.

Nothing else about the service moves. It keeps its name, its address, its folder — the name of
that folder is made from the service's name, not from a moment in time — and its storage, which
is a folder of its own beside it, never inside what an install empties. Which is to say: after
a `git clone` install line runs again, the working copy is new and `data/<service>/…` is
exactly what it was.

Whatever serviceman gave up on before is forgiven at that moment: a service that had used up
its start attempts gets them back, because this is a different program now.

### A new version of an app folder

An app folder (`bin/run` in a folder named in `cwd`, as **An app folder** on the New service
form makes one) takes a new version as a zip: **New zip…** on its page, in place of **Fetch
again**. What the app keeps lives in its `data/`, and that is all that outlives a new version:

1. the page reads the zip and sends its files beside the folder, to `<folder>.new`;
2. serviceman stops the app, sets the folder aside as `<folder>.old` and puts `<folder>.new` in
   its place;
3. `bin/configure` runs in it;
4. `data/` is moved over from the old folder, over any `data/` the zip brought, and the old
   folder goes;
5. the app starts again if it was running.

Whatever fails before `data/` is across puts the old folder back as it was and starts it
again: the app runs the version it had, and the new files wait in `<folder>.new` to be looked
at. `POST /api/v1/services/<name>/replace` is step 2 onwards, for whoever put the files there.

### Storage

A program that keeps something names the paths it keeps:

```json
"volumes": [":/app/data"]
```

**That is the whole of it — a path, and nothing to name.** serviceman keeps it as a folder in
the agent's own directory on the machine that runs the service:

    ~/serviceman-agent/data/<service>/app-data   →   /app/data

So everything the agent made is in one place and goes when the agent does, and `bin/uninstall`
plus one `rm -rf` still leaves the machine as it was found. Everything else the program writes
goes when it stops — including its own folder, which an install line empties.

A source before the path is still read, for the cases that need one: a name is a docker volume
that other services may share (`"shared:/mnt/things"`), and something with a `/` is a path on
that machine (`"/srv/x:/data:ro"`).

**A service that keeps something names one machine, and only one.** What it keeps is on the
machine that holds it and goes nowhere: a list of machines to fall back on would mean the same
service coming up with somebody else's data, or with none, and a `#tag` would mean any machine
at all. serviceman refuses both at config time rather than finding out later.

The **Storage** row on the control page lists everything kept, the machine each thing is on,
and which services keep what in it.

### Secrets

A program that needs a key, a token or a client secret asks for it by name:

    secrets credentials

serviceman keeps those values in `data/secrets.json` — mode 600, beside what it writes about
itself, **never in the config** — and they are made on the control page, not in a file.

**A secret made on a service's page is that service's own.** Nothing else can read it, and it
cannot be reused elsewhere: two services may both hold a `token`, and they are not the same
token. The **Secrets** row in the rail holds a *library* beside them — values written down once,
to be copied into as many services as need them. Copying happens on the host: a value that is
kept here never goes out to a page and back.

At start, the secrets of a service are put on the machine that runs it — `600`, in the agent's
folder — with a `secrets` command beside them: on the program's PATH when it runs on the
machine, mounted at `/usr/local/bin/secrets` when it runs in a container. A service with no
secrets gets no file and no command at all.

### An image as the environment

```json
{
    "name": "google-docs-writer",
    "type": "shell",
    "remote": "laptop",
    "image": "node:24-alpine",
    "publish": {"host": "google-docs-writer.example.com", "port": 8090},
    "command": "bin/run",
    "lifecycle": {"install": "npm install"}
}
```

With an `image`, every line runs **inside a container of that image**, with the program's folder
mounted at `/app` and `/app` as the working folder. The install line becomes

    docker run --rm --volume <folder>:/app --workdir /app node:24-alpine /bin/sh -c "npm install"

and the program itself becomes a container of serviceman's own, published like any other:

    docker run -d --name serviceman-google-docs-writer --label serviceman.service=… \
        --volume <folder>:/app --workdir /app --publish 127.0.0.1::8090 \
        node:24-alpine /bin/sh -c "bin/run"

**Nothing of ours runs in a container as root.** The default is the user running serviceman or
the agent, by number — `--user 1000:1000` — because a container that writes into a mounted
folder as root leaves a folder its owner cannot empty, cannot reinstall into and cannot take
away. `"user": "node:node"` names one the image has instead, which is the tidier answer when
the image was built with a user for the job. `HOME` is `/app` either way, so npm and its like
have somewhere of their own to cache.

So the machine needs docker and nothing else — no node, no npm, no version of anything on it.
From there it is an ordinary container of ours: the same stopping, the same finding it again
after a restart. The folder stays on the machine, so what the install
line writes into it outlives the container.

**A program that installs itself gets a folder of serviceman's own.** With no `cwd` in the
config it is `<name>.<suffix>` — `google-docs-writer.07c20748` — under `data/services` on this
host, and under `services` in the agent's folder on a remote. The suffix follows the name and
never changes, so `update` and every restart find the same folder, and nothing made there by
hand can ever be mistaken for it.

**An install always starts from nothing.** A folder serviceman made is emptied before the
install line runs, so `git clone .` means what it says, and it is taken away again if the line
fails — half an install is worse than none, because the next try would meet its own leftovers
and fail on those instead. A folder **you** named in `cwd` is never emptied and never removed;
what an install line does in there is between you and it.

**Uninstall means gone.** A program that leaves the config is stopped — it is serviceman's own
child, and leaving it would leave an orphan nobody adopts — and the folder serviceman made for
it is removed with it. A folder **you** named in `cwd` is yours and is never touched: serviceman
takes away only what it put there. On a remote the agent does the removing, and refuses any
path that is not inside its own home.

What is left behind on a machine that was offline at that moment, or by a container of a
service that was removed, is written down in [orphans](orphans.md) — a case that is not
resolved yet.

A step that fails stops what it was part of: a failed install fails the start and the reason is
on the waiting page. A failed stop line does not keep the program alive — it is signalled all
the same, and the log carries what the line said.

There is no `start` line, because that is `command`, and no `sleep` or `wake`: a program that
sleeps is a program that was stopped, and waking it is starting it again. Its stop line runs
with `SERVICEMAN_REASON=idle` when the idle clock is what stopped it.

**A program may name a `remote` or a `#tag`**, the same as a container. The agent over there
runs the install line, keeps the child, and serviceman reaches it down the same tunnel. What
that machine needs is whatever the two lines need — for the one above, git and node.

**With a `publish.port`** the program is a service like any other: an address wakes it, the
idle policy stops it. Each of its lines finds that port as `PORT`, so `bin/run` listens where it
is told and the port is written once; an `env` that names `PORT` itself wins. **Without one**
it answers nowhere — a socket, a tunnel, a job — so it carries no `publish` at all and it starts
with serviceman (`"start": "always"`).

A program runs as one copy. The agent keeps the last of what it prints, and the waiting page
reads it while the program comes up. The agent stops the whole process group, so a shell line
takes its children with it.

serviceman stops the programs it started when it stops itself, through the agent. The agent
holds the child, so a program outlives neither: an agent that is restarted answers that nothing
of its runs, and the program is started again at the next request.

## Policy

| Field              | Default                  | What it does                                                              |
|--------------------|--------------------------|---------------------------------------------------------------------------|
| `start`            | `on_demand`              | `on_demand` starts at the first request. `always` starts with serviceman. |
| `stop_after_idle`  | `10m`                    | Stops the service after this much quiet. `false` keeps it up.             |
| `start_timeout`    | `120s`                   | How long a start may take to answer before it counts as failed.           |
| `start_tries`      | `2`                      | Starts that may fail in a row before serviceman stops trying.             |
| `request_timeout`  | `60s`                    | A request with no answer for this long gets 504. `false` waits forever.   |
| `instances`        | `{min: 0, max: 1}`       | How many copies of the service may run. See below.                        |
| `concurrency`      | unlimited                | Requests one instance takes at once. The rest wait in line.               |
| `warmup`           | `{queue: 1, wait: "2s"}` | When the line is long enough to start another instance.                   |
| `scale_down_after` | `2m`                     | An extra instance with no work for this long is stopped.                  |
| `restart`          | `on_failure`             | What follows a program that stops by itself. See below.                   |

Durations are `500ms`, `30s`, `10m`, `2h`, `1d`. A plain number is seconds.

**A service that cannot start is not asked forever.** A broken command, a missing setting, an
image that is not there — none of those get better by being tried again on every request, and
each try repeats the whole cost: the clone, the install, the pull. After `start_tries` starts
that failed in a row serviceman gives up (`service_gave_up`), and every request after that is
answered from what is already known — no work, the same reason, at once.

Three things are a change, and each one lets it try again: **you asking** (the Start button, or
`POST /api/v1/services/<name>/start`), **its machine coming back**, and **its definition being
edited**. The log says so with `service_try_again`.

`restart` is `on_failure` (a bad exit code brings it back), `always` (any exit brings it
back) or `never`. serviceman waits a second before the first restart and doubles the wait
up to thirty seconds; a program that ran half a minute starts that count again. It applies
to programs — a container is restarted by docker, through `run_args`.

An `always` service is never stopped by the idle policy. A service with requests in flight
is never stopped either — the clock starts when the last one finishes.

### When a service counts as ready

serviceman asks the service for `/` and waits for an answer. Any answer counts — a 404 and a
500 are still something inside speaking HTTP — and the request goes through the same pool the
visitors will use, so a service on a remote is asked down its own tunnel with the header
`user-agent: serviceman-probe`.

An open port is not enough on purpose: docker publishes the port before the app inside binds
it, so a socket that connects only proves docker is there, and the first visitor would meet a
reset. A port that answers nothing for `start_timeout` fails the start, and the reason names
the likely cause — `is publish.port (5000) the port it listens on inside?` A start that is
merely slow says so in the log after ten seconds and carries on waiting.

### Stopping a service

`policy.stop_timeout` is how long a service is given to stop by itself before it is made to.
Unset, each kind keeps its own: **ten seconds for a container**, which is what docker gives, and
**five for a program**.

What is stopped is never one process. A shell line is a chain — `bash` → `npm` → `sh` → the
server — and neither bash nor npm passes a signal on, so the process serviceman started is not
the one holding the port. serviceman signals the whole process group and waits for the whole
group: the stop is over when nothing of it is left, not when its first process went.

A service that takes the whole timeout every time it stops never received the signal at all.
The log says so — `program_killed` for a program, `container_killed` for a container — and the
cure is in the program, not in the timeout: a `command` that ends in `exec` is one process, and
one process stops in milliseconds.

    bin/run:  #!/bin/sh
              exec node src/http.js

`exec npm start` is not enough: npm makes its own child and drops the signal on the floor.
`notes/signals-through-a-process-chain.md` has the measurements.

Every container serviceman makes is run with `--init`, because the trap has a second half: a
program that is pid 1 of its container never receives a signal it has no handler for — the
kernel throws it away, `pid_namespaces(7)` — so even a perfect `exec` chain would sit out the
whole timeout. With `--init` docker's own init is pid 1 and the program is its child, with
ordinary signal rules. The spec hash carries a version of the run line itself, so containers
created before the flag are replaced on their next start — storage survives the replacement,
anything written inside the container goes, as always.

## More than one instance

```json
"policy": {
    "instances": {"min": 1, "max": 4},
    "concurrency": 10,
    "warmup": {"queue": 3, "wait": "1s"},
    "scale_down_after": "2m",
    "request_timeout": "30s"
}
```

With `concurrency` set, an instance takes that many requests at once and the rest wait in
line. The line is what drives the pool:

- A new instance starts when `warmup.queue` requests wait, or when one request has waited
  `warmup.wait` — whichever comes first, and only while fewer than `instances.max` are up.
- A request that reaches `request_timeout` — waiting in line or waiting for the answer of
  the service — is answered with 504. The clock starts on an awake service; a cold start is
  `start_timeout`'s business.
- An extra instance with no work for `scale_down_after` is stopped. The pool never shrinks
  below `instances.min` (or below one, while the service is awake).
- `stop_after_idle` still stops the whole service, `instances.min` included; the next
  request starts the first instance, and the rest of `min` warm up behind it.

Without `concurrency` there is no line, so the pool never grows by itself — `warmup` needs
`concurrency` to mean anything.

### The pool follows the work

`warmup` grows the pool once visitors are already waiting. `autoscale` grows it before that,
from how full the pool is:

```json
"policy": {
    "instances": {"min": 1, "max": 6},
    "concurrency": 4,
    "autoscale": {"busy_up": 0.7, "up_for": "10s", "busy_down": 0.2, "down_for": "2m", "cool_down": "1m"}
}
```

`busy` is the share of the pool that is working — requests in flight and in line, over what the
running copies can take at once. Every five seconds serviceman looks:

- **busy at or over `busy_up` for `up_for`** — start as many copies as the load asks for, up to
  `instances.max`.
- **busy at or under `busy_down` for `down_for`** — stop one copy, never below `instances.min`
  (or below one). The emptiest copy goes; one with a request in flight is left alone.
- **nothing at all for `cool_down` after a change** — the pool cannot flap on one number.

The two thresholds must differ, and `busy_down` under `busy_up` is checked at load.

**A slow start moves the line.** A copy that took ten seconds to answer must be started before
the pool is full, or every visitor after it waits through another ten. serviceman remembers how
long the last copy took and lowers `busy_up` by 0.02 for every second of it, never below
halfway to `busy_down`. The log says where the line stood: `busy 0.82 of 0.50 for 12.000s`.

Leave `autoscale` out and nothing scales by itself — `warmup` and `scale_down_after` behave
exactly as before.

Extra containers are named `serviceman-<name>-2`, `serviceman-<name>-3`, and so on. Every
instance of a docker service shares the same volumes — the service must be ready for that.

## type: docker

```json
{
    "name": "grafana",
    "type": "docker",
    "publish": {"host": "grafana.example.com", "port": 3000},
    "image": "grafana/grafana:latest",
    "env": {"GF_SERVER_ROOT_URL": "https://grafana.example.com"},
    "volumes": ["/srv/grafana:/var/lib/grafana"],
    "network": "backend",
    "run_args": ["--memory", "512m"],
    "args": []
}
```

| Field      | What it is                                         |
|------------|----------------------------------------------------|
| `image`    | Required. The image to run.                        |
| `env`      | Names and values for `--env`.                      |
| `volumes`  | Storage. See below.                                |
| `network`  | The docker network to join.                        |
| `init`     | `false` leaves docker's `--init` out, for an image that has to be pid 1 itself — one built on s6-overlay quits otherwise. Default `true`. |
| `run_args` | Anything else for `docker run`, written as a list. |
| `args`     | The command line for the image itself.             |

serviceman runs `docker run -d --name serviceman-<name> --label serviceman.service=<name>
--publish 127.0.0.1::<port> ...`. Docker picks the host port, serviceman reads it back with
`docker port`, so two services never fight over a number.

**Pull** on the service's page fetches the image again. A tag is not a version — `:latest`, or
`:24`, or anything else somebody pushes over, is a name for whatever was published under it
last — and a machine that already has an image by that name never asks again. This is the ask.
Then it asks the container which image it was made from: where that is not the image the name
stands for now — a different one came down, now or before, by this pull or by a `docker pull`
on that machine — the container is taken away and made from the image the name stands for, and
a service that was running is running again at the end. Where the container is already of that
image, nothing is touched. `POST /api/v1/services/<name>/pull` is the same thing without the
page.

The container is kept when the service stops, so the next start is a `docker start` and the
logs stay. serviceman recreates the container when the definition changes — image, port, env,
volumes, network, run_args or args. It carries the fingerprint of the definition as the
`serviceman.spec` label and compares it at every start.

## What a start shows

A first start of a docker service is mostly a download, and a fat image is minutes of it. That
is a step with a name of its own: the waiting page and the service page say

    Downloading vbarbarosh/notes — 56% · 256.35MB of 458.43MB · 54.50MB/s · 4s left

with a bar that follows it, and the log keeps every line docker printed as `docker_stdout`.

The numbers come from docker itself, one layer at a time. Two things are worth knowing:

* **docker only draws progress for a terminal.** Through a pipe it drops every message that
  carries a progress bar — see `Display` in moby's `pkg/jsonmessage` — so the pull is run
  through `script -qefc '<docker> pull <image>' /dev/null`, which gives it the terminal it is
  looking for. A machine without `script` (util-linux) still pulls; it just cannot say how far
  it is, and says so once as `docker_pull_no_pty`.
* **docker has no overall percentage**, only per-layer bytes, and it names a layer's size only
  when that layer starts downloading. The percentage here counts the layers it has named and
  treats the ones it has not as an average of them — an estimate while it lasts, exact by the
  end. Without it the bar would walk backwards every time a new layer arrived.

Everything else a start does says so too: `making the container from <image>`, `starting the
container that is already here`, and, past three seconds of silence, what is being waited for
and whatever the service itself is writing.

## Storage

A service that keeps data gets a `volumes` list. **The short form is a path and nothing else**
— the same line a program of the shell kind writes:

```json
"volumes": [":/app/data"]
```

That says: this path survives the container being made again, and everything else the container
writes goes with it. There is nothing to name — the agent keeps the folder itself, under its
own directory on the machine that runs the container:

    ~/serviceman-agent/data/<service>/app-data   →   /app/data

A machine that runs a container with such a path needs an agent new enough to say where it
lives; an older one is told to run `bin/update` and nothing is started with a path that cannot
be resolved. **A service that keeps anything runs on one named machine** — the folder is there
and goes nowhere, so `remotes` may not be a list or a `#tag`.

Write a source before the path for the cases that need one — a named volume other services
share, a folder that already exists — as a string the way docker takes it, or as an object:

```json
"volumes": [
    "grafana-data:/var/lib/grafana",
    "/srv/grafana/conf:/etc/grafana:ro",
    "data/uploads:/uploads",
    {"source": "/mnt/big/photos", "target": "/photos", "readonly": true, "create": false}
]
```

| Field      | What it is                                                                          |
|------------|-------------------------------------------------------------------------------------|
| `source`   | A named docker volume, or a folder on that machine. Empty: a folder the agent keeps for this service. |
| `target`   | Where it appears inside the container. It starts with `/`.                          |
| `readonly` | `true` adds `:ro`.                                                                  |
| `create`   | Make the host folder if it is missing. `true` by default, ignored by named volumes. |

A source with a `/` in it is a folder on the machine; a source without one is a named docker
volume — the same rule docker uses. Write a folder as an absolute path: a relative one is read
against the config folder on this host, which means nothing on the machine that runs the
container. `~` is the agent's home.

The agent makes a missing folder before it starts the container. Without that, docker makes
it as root and the service cannot write in it.

## type: external

```json
{
    "name": "rockpool",
    "title": "Terminals",
    "type": "external",
    "publish": {"host": "terminals.example.com"},
    "upstream": "127.0.0.1:7000"
}
```

Something that already runs, and keeps running whatever serviceman does: another program with
its own supervisor, a box on the network, a tool you start by hand. serviceman gives it an
address and passes requests on.

| Field      | What it is                                                      |
|------------|-----------------------------------------------------------------|
| `upstream` | Required. Where it already answers, as `host:port`. Plain HTTP. |
| `remote`   | The machine it runs on, when that is one of the remotes. Optional. |

### Something already running on a remote

With `remote`, `upstream` is an address **on that machine**, and serviceman reaches it through
that machine's link, the way it reaches a service it started there. Nothing is opened on the
machine and nothing else needs a route to it — a port bound to its loopback is enough.

```json
{
    "name": "logline-ui",
    "title": "Logline",
    "type": "external",
    "remote": "server",
    "publish": {"host": "logline.localhost"},
    "upstream": "127.0.0.1:8081"
}
```

It is still never started or stopped. When the machine's link is down a visitor gets 502, the
same as for a service that does not answer, and it answers again the moment the link is back.

It is never started, never stopped, never reaped — **Start** and **Stop** are refused, and
only its cards are left on the control page. `publish` is
the address it answers on here; there is no `publish.port`, because nothing has a port
*inside*. When it stops answering a visitor gets 502 and the address stays as written, since
there is nothing serviceman could restart.

## Load tests

A load test sends [k6](https://k6.io/) at a service: a number of users asking for one address
for a while. The **Load tests** page makes them, runs them and keeps what each run measured; this
is the list it writes.

```json
"load_tests": [
    {"name": "whoami", "service": "whoami", "remote": "laptop", "vus": 20, "duration": "30s", "p95_ms": 500, "errors_pct": 1}
]
```

| Field        | What it is                                                                                  |
|--------------|---------------------------------------------------------------------------------------------|
| `name`       | Required. Lowercase letters, digits, `-` and `_`.                                           |
| `service`    | Required. The service it measures; it is woken before the clock starts.                     |
| `remote`     | Required. The remote k6 runs on, as the `grafana/k6` container, removed when it is done.   |
| `url`        | The address asked. Optional: without it, the service's first address on `listen`.           |
| `vus`        | Required. Users asking at once, 1 to 1000; each asks again as soon as it is answered.       |
| `duration`   | Required. How long it runs, `1s` to `1h`.                                                   |
| `p95_ms`     | It passes when 95% of the answers came faster than this. Optional.                          |
| `errors_pct` | It passes when no more than this share of the answers failed. Optional.                     |

k6 runs with the remote's own network, so a name under `.localhost` is that remote's loopback:
to reach serviceman's `listen` there, run it from the remote on the machine serviceman runs on.
A public name works from any of them. The last 20 runs of each test are kept in
`data/load_test_runs.json`.
