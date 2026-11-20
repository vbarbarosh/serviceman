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

Services are created and reshaped on the control page itself. **New service** stands in a card of
its own, as every form that makes something does: one question a screen with a line under it, the
steps in a band above keeping each answer, a click on one going back to it, and **Back**, **Show
serviceman.json** and **Next** in a bar at its foot, with why **Next** waits beside it. **One
page** beside **Step by step** puts every question on one page with what **Create** makes beside
them; the switch keeps every answer. **What** is a tile each: Docker image, App folder, Program,
Folder of files, Database (which opens [Databases](databases.md)), App on a socket, Already
running. Then where it comes from (the image, the folder, the line that runs it, the socket, or
where it answers already), the **Machine** for what runs on one, a tile each with whether it is
online, what it is, how many services it runs and its free memory of all, with a meter of it, and
**Add a machine**, which opens New remote and comes back with that machine picked; the
**Address** and who may open it, anyone or signed in behind a wall; and **Check**, a row per
answer with **Change**, and the rest at serviceman's defaults. A **Create** serviceman refuses
says why in red on Check, nothing written, and the button becomes **Create again**.
**A docker image** asks for the image; the name comes from it
and the port defaults to the one the image names, or 80. **An app folder** asks for the app's folder
on this computer, or a `.zip` of it: **A folder…** or **A .zip…**, or either dropped on the
form. The folder must hold `bin/run`, which serves the app on the port it finds in `PORT`, and
may hold `bin/configure` and `bin/build`, which then run once before the first start, in that
order, as a fresh checkout is made ready: its install line is
`if [ -e bin/configure ]; then bin/configure; fi && if [ -e bin/build ]; then bin/build; fi`. The page reads it and
sends its files on **Create** to the machine, so the machine needs no `unzip`: a zip's files
keep their modes, and a folder's, which a browser hands over without any, run when they are in
`bin/` or start with `#!`. serviceman chooses where they go: `services/<name>` in the agent's
own folder, where everything the agent installs lives (`~/serviceman-agent/services/<name>`
for an agent installed as its user), and never a folder that holds files already. It stays
there when the service is removed, with the app's `data/`, which is the service's working space:
nothing ever merges into it or overwrites it, a new version included. A folder already on the machine is
named in the whole form, as the program's working folder. The name comes from the folder or
the zip, and the port is the first one from 8080 that no other program is given and the machine does not listen on. **A program** asks for the line that runs it, on that same first free port unless one is typed. **An app on a socket** asks for a name, where its app listens,
serviceman's own `data/` folder unless a machine is picked (or the form was opened from a machine's
page), and the socket file there, `data/sockets/<name>.sock` or `~/<name>.sock` on a machine unless
another is typed: serviceman passes every request into that file and never starts or stops the app
([something listening on a socket file](#something-listening-on-a-socket-file)). Each gets an
address made of its name unless one is typed; what runs on a machine, the first one there is, or
the one it was added from. **Change** under the rest, on Check, opens the whole form, every card,
with what the steps filled in, as does a problem no step shows; an address with a path strips
its prefix. A service's own
page says how it stands once, in its head: a pill with its time (`running · up 58s`,
`starting · 12s`, `restarting · 3rd time`), and the buttons that fit (Stop and Restart while it
runs, Start when it is stopped). When that wants a word, a note under the head says why, with
**All logs** or the way to its machine: starting (how long so far, when it is up, its last
lines), stopped by you (when, how long it ran, that only Start starts it), failed (how it ended
and when, the starts in a row, whether serviceman stopped trying), stopping badly over and over
(how many times since when, the next try, how it ended the last time) and its machine offline
(since when). A new version or an image on its way is shown there too, with its bar. The
page reads how it runs on its **Overview**: how long it is up, its last start (or its requests,
once it has an address), how many starts failed in a row, its machine's CPU, memory and disk,
what runs with each option as a chip (**Copy** takes the whole line, **Edit** opens its card),
its newest lines and its addresses; nothing there is set. It has the same cards under its
**Settings** tab, four a row, **What runs** over two, each with **Edit** — addresses, image,
storage, environment, the whole policy. **Edit** opens that card across the top, the others
stepping back. A program's **What runs** shows its command an option a line, numbered, with
`sg <group> -c '` and its `'` as fixed lines around them when it runs as a group (**Runs as
the group**, beside **Its folder**); a line changed is marked with what it was, and Save
joins the lines with single spaces, so the file keeps one line (a command written over
several lines is a script, and keeps them). Its port, image, install and update lines and
variables are folded in a row that says what it holds. The card's foot says its change alone
(`--ctx-size 65536 → 262144`) and what Save does to the service as it stands now: a save
writes the config file and applies it at once, starts nothing stopped and restarts nothing
running. What runs, where it runs and what it keeps are taken at its next start: a running
one offers **Save, restart later** and **Save and restart**, which restarts it once on what
was saved, and a stopped one stays stopped and runs it at its next Start. Its addresses, its
policy and its copies are taken at once; a new name stops it and starts it again under that
name. **Cancel** puts the card back. **Show serviceman.json**, in the same foot, shows the
whole entry before you save; only the fields you fill land in the file, and what no card
shows (`run_args`, `args`, `argv`, a key written by hand) stays in the file as it was. A
service made another kind loses
what the kind it was alone reads (`run_args` and `args`, or `argv`), and a line typed into a
program's **Command** takes the place of its `argv`. **Remove…**, the last card, takes a
service out of the config — anything running keeps running.

Everything in this file has a place on that page: **Runs on** is a list of machines and
`#tags` in the order they are tried, **Follow the load** turns the autoscaler on under
**Copies**, the checkbox beside the image fetches it before the first visit, a remote's **Tags**
sit in its form, and **Let machines join** on the Remotes page holds the join token and the tags a
machine may claim.

For the edge cases the pencil opens the config file in a code editor. Its head names the
file and says whether the text is still what the file holds: unchanged, or changed, not saved.
Each `token` in it is drawn as dots and a number (`"•••••••••••• 2"`), and **Check** and
**Save** put it back as it was, wherever its block was moved; a token typed over the dots is
the new one. **Check** reads the text and reports what is wrong without touching anything.
**Save** writes the file and applies it the same way:

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
| `apps`       | none                | The domain an app sent to serviceman is named under, the apps' own ports, the wall in front of the page of apps and every app (`auth`), and where their tailnet links are said to be http (`http_said`). See **An app sent to serviceman**. |
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
and runs no docker. **New remote** on the control page writes this block for you. serviceman
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
| `by`          | Written by serviceman, never by hand: `{"token": "<id>", "label": "visual-agency"}`, the token that asked for it, on a forward a token's `PUT` added or changed. The page shows it beside the label. |
| `service`     | The service it is part of, a program whose port it brings over ([Its port on another machine](#its-port-on-another-machine)). It goes with that service: renamed with it, taken out with it, its `from` moved with the machine the program runs on. The owner's alone: a token neither sees it nor writes one. Left out, the forward is one of its own. |

Both machines run the agent, version 1.15 or newer; one that shows up on serviceman itself
needs it only on `from`. [Remotes](remotes.md#a-port-or-a-socket-from-one-machine-to-another)
says what happens while one of them is away, and [onto serviceman itself](remotes.md#a-forward-onto-serviceman-itself)
where its socket lands. Both ends may be one machine, an address it reaches brought to its own
loopback: its agent joins them itself, and serviceman carries none of it
([Both ends on one machine](remotes.md#both-ends-on-one-machine)).

A program reads the list with `GET /api/v1/forwards`, `{"forwards": [...]}` as this file writes
them, and writes it back whole, changed, with `PUT /api/v1/forwards`. A token with the
`forwards` right ([A token for every caller](deploy.md#a-token-for-every-caller)) gets the
forwards between its machines alone, both ends on them, and the list it writes takes their
place: every other forward stays as it was, where it was. One with `forwards_read` gets the
same list and writes none, a `403`. Its forwards carry ports and sockets of
its machines: one onto serviceman itself (`to.here`) or to an address beyond the machine
(`from.host`) is the owner's, and a `403` says which forward named it.

What a token's list adds or changes says that token asked for it, in `by`; what it sends back
as it was keeps the `by` it had, and a `by` the token sends is never taken. When the token is
revoked, or changed so it no longer sees a machine of the forward or no longer has the right,
its forwards are set aside (`off`) at once, `by` kept, and the page says the token is revoked.
Turning one on again, on the page, keeps its `by`; changing it there makes it the owner's.

Beside them the answer says where each socket and port of serviceman's own comes from, for a
program that carries the same on to a machine: `"sources": [{"socket": "sockets/loki.sock",
"from": {"remote": "vps1", "port": 3100}}]`, one for every forward onto serviceman itself that
is not set aside, `{"port": …}` for one on its loopback, `from` as this file writes it. A token
gets those whose `from.remote` is a machine it sees: a token that carries `loki.sock` sees
`vps1` and the machine it carries it to. The sources are read and never written: `PUT` keeps
them as they are, whatever it is sent. One whose `from` has a `host` is listed too, and a token
may not carry it: its forward would reach an address beyond the machine, and is the owner's.

### Mounts

A folder of one machine, mounted on another, read-only or read-write: `from` is where the folder
is, `to` where it shows up. sshfs on `to` speaks SFTP straight to the agent of `from`, over the
tailnet (through serviceman when the two agents cannot reach each other), to the folder, which
shows it and nothing outside it. No ssh and no key.
**Mounts**, on All categories, writes this list for you; [Mounts](mounts.md) says how it works.

```json
"mounts": [
    {"label": "photos", "from": {"remote": "laptop", "path": "~/Pictures"}, "to": {"remote": "vps1", "path": "/mnt/photos"}, "mode": "ro"},
    {"label": "serviceman's data", "from": {"here": true, "path": "."}, "to": {"remote": "vps1", "path": "/mnt/serviceman"}, "mode": "ro"}
]
```

| Field         | What it is                                                                         |
|---------------|------------------------------------------------------------------------------------|
| `label`       | Any text of one line, up to 100 characters, one per mount.                         |
| `from.remote` | The machine the folder is on.                                                      |
| `from.here`   | Or `true` in place of `from.remote`: the folder is serviceman's own, in its state dir. |
| `from.path`   | The folder: from `/` or `~/` on a machine, `~` the agent's user's home. On serviceman itself, a folder inside its state dir written from it, `.` for the whole of it, never through `..`. |
| `to.remote`   | The machine it is mounted on, with the agent's root half. Never serviceman itself. |
| `to.path`     | Where: a full path one level below the top at least (`/mnt/photos`), never under the system's own folders (`/etc`, `/usr`, `/var/lib/serviceman`…). Two mounts on one machine never share a path, nor sit one inside the other. |
| `mode`        | `ro` (read-only, the default) or `rw` (read-write).                               |
| `off`         | `true` sets it aside: written down, and not mounted.                               |

Both machines run the agent, version 1.38 or newer; a folder of serviceman's own needs it only on
`to`. A program reads the list with `GET /api/v1/mounts`, `{"mounts": [...]}` as this file
writes them, and writes it back whole, changed, with `PUT /api/v1/mounts`. Both are the owner's
alone: no token's right reaches them.

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

**Space** on Logline's page says what its lines take, day by day: a bar a day from the oldest to
today, and the days in a table with their size, their lines and their size before compression.
**Delete older than** a week, 2 weeks or a month drops the days before that whole: Logline keeps
a day as one piece of its table, so a day goes at once and its space with it, and today never
goes. Picking a period turns the days it would delete red before anything goes, and the delete
is asked once more. serviceman asks Logline for both with the admin token, as for the tokens, so
nobody who only opens Logline's viewer can delete. A table that deletes lines by itself (a TTL)
says so there.

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
Logline in batches: what ten seconds gather, or a thousand lines, whichever comes first, so a
trickle is a batch every ten seconds and not an insert a line. A batch leaves the spool only
when Logline has it; while Logline cannot be reached the spool grows, up to a gigabyte or a tenth
of the disk, and then the machine stops reading and docker keeps the lines until there is room.
A batch Logline answers it will never take as it is (a 400, a 413, or a 422 for what its store
refuses about the lines themselves: a time the table cannot hold, more days than one insert
may span) is halved, and its half again, until a half is taken: a batch of too many days goes
in so, by halves, and what is left at the end is the one line Logline refuses. That line is put
aside in `<agent folder>/logline/spool/refused/`, a file with Logline's `answer` and the line as
`POST /lines` takes it, in `batch`, and every other line goes in. Nothing sends such a file
again, and nothing deletes it; the problems bar names the machine for as long as one is there,
its card with what Logline answered for the newest file, and counting from the oldest one.
The folder keeps a thousand files or 64 MB: past that the refused line waits in the spool with
every line behind it, as for a Logline that is away, until there is room. The card is a warning
while lines still go, and turns to a failure once a refused line waits there for room. Once what Logline
refused is mended, a file goes by hand, from the machine, to where and with the token its agent
was told in `logline/settings.json`:

    cd <agent folder>/logline
    jq -c .batch spool/refused/38-38.json | curl -sS --data-binary @- \
        -H "authorization: Bearer $(jq -r .token settings.json)" "$(jq -r .endpoint settings.json)"

A container labelled `logline=off` is left alone: Logline's own four carry it, so the machine
Logline runs on does not send Logline its own lines back. The agent's own lines go too — what it
connected to, what it was asked, what went
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
{"name": "grafana", "type": "docker", "remotes": ["#gpu"], "publish": {"host": "grafana.example.com", "port": 3000}, "image": "grafana/grafana:latest"}
{"name": "api", "type": "docker", "remotes": ["vps1", "#eu"], "publish": {"host": "api.example.com", "port": 8080}, "image": "demo/api"}
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
other. It is named after its name on the tailnet, `name_prefix` before it (`auto-laptop`
for `laptop.tail1234.ts.net`), or after its hostname on a machine with no tailnet. That secret is handed to the machine as it joins, and its agent keeps it beside itself
(`token` in its folder) and dials with it from then on: the same machine coming back takes its
own entry again instead of leaving a dead one, and once it has dialled with its own token the
join token is refused for its name (`remote_refused` with `joined_before`), so whoever holds the
join token cannot come back as a machine that already joined. A host that no longer knows the
kept token (its `data/` gone, or another host altogether) refuses it as `unknown_token`, and the
agent dials next with the token it was started with: the join token joins it again, and the
token handed then takes the old one's place (`agent_token_unknown` in the agent's log).

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
    "remotes": ["vps1"],
    "publish": {"host": "grafana.example.com", "port": 3000},
    "image": "grafana/grafana:latest",
    "policy": {"start": "on_demand", "stop_after_idle": "30m", "start_timeout": "90s"}
}
```

| Field     | What it is                                                                       |
|-----------|----------------------------------------------------------------------------------|
| `name`    | Lowercase letters, digits, `-` and `_`. It names the container and the API path. |
| `title`   | The name on the control page and on the waiting page. Optional.                  |
| `type`    | `docker`, `shell`, `external` or `files`.                                        |
| `publish` | Everything outside: the address it answers on, and the port behind it.           |
| `remotes` | The machines it may run on, best first. Required for `docker` and `shell`; none for the rest. |
| `redirect`| Wake it, then send the visitor to this address instead of proxying. Optional.    |
| `auth`    | The service to ask before anything of it answers, at every address it has: an authwall ([behind a wall at every address](#behind-a-wall-at-every-address)). Optional. |
| `policy`  | The fields below.                                                                |

Everything else in a service says how it is run: the image, the command, the address it
already answers on.

### Behind a wall at every address

`auth` puts a service behind a wall wherever a visitor comes from: its own address on
serviceman, every name a machine's door gives it, a websocket. The wall is another service,
[authwall](https://github.com/vbarbarosh/authwall) or anything that answers its door, and it is
asked as a door asks it ([a wall in front of a name](remotes.md#a-wall-in-front-of-a-name)):
before anything of the service is touched, even whether it is up; a no sends the visitor to
`/auth/sign-in` on the name they asked for, and `/auth/…` there is the wall's own.

```json
"services": [
    {"name": "authwall", "type": "external", "publish": {"host": "authwall.localhost"}, "upstream": "127.0.0.1:3200"},
    {"name": "notes", "type": "files", "publish": {"host": "notes.localhost"}, "auth": "authwall"}
]
```

A door's rule may name a wall too: a service with its own asks its own, once, in place of the
rule's. On **Apps** it is the **Sign-in** list in an app's **Settings**, and the same list is
**Sign-in** in the **Addresses** card of any service's page: open, or behind one of the walls
there are; an app behind one has a lock before its address, and the **Authwall** page lists it
with every address it has.

### A wall per team

Each team may have a wall of its own, with its own users: the **Authwall** page lists the walls,
and **+ A wall for another team** makes one, a copy of `authwall` under a new name
(`authwall-team-a`, its title the team's). The last option of every **Sign-in** list opens that
form. A wall is a service called `authwall`, one whose name starts with `authwall-`, or any service
something stands behind.

The copy runs as `authwall` does: the same image, port, machines and environment, who may sign
in among them. It is a wall of its own: its address is made of its name
(`authwall-team-a.localhost`, and a setting naming `authwall.localhost` names the new one), every
path it writes is kept under its own name, and it takes none of `AUTHWALL_SECRET`, `AUTHWALL_DB`
and `AUTHWALL_SEED`; the first user typed in the form is its seed. Only a wall serviceman runs as
a docker image can be copied. The same through the control door:

    POST /api/v1/walls
    {"from": "authwall", "name": "authwall-team-a", "title": "team A", "user": {"username": "ann", "password": "…", "email": "ann@example.com"}}

`user` may be `null`, for a wall with no user yet.

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
{"name": "pdf", "type": "docker", "remotes": ["vps1"], "publish": {"host": "tools.example.com/pdf", "port": 3000}, "image": "demo/pdf"}
{"name": "img", "type": "docker", "remotes": ["vps1"], "publish": {"host": "tools.example.com/img", "port": 3000}, "image": "demo/img"}
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
    "remotes": ["laptop"],
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
    "remotes": ["server"],
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

### Its port on another machine

A program that listens on a port of its machine's loopback, a language model's server say, is
used from another machine: the laptop. **Its port on another machine**, a card of the program's
form, says which port and where it shows up, and the program's **Create** or **Save** writes the
program and its forwards together. Each machine picked gets the port as a socket file,
`~/.sockets/<name>.sock` unless another is typed (an agent after 1.40.1 makes the folder,
`0700`; an older one wants it there), or as a port on its loopback; the program's own machine
may be picked too, for another port there. **This host**, where serviceman runs, needs no agent:
serviceman listens itself, on `sockets/<name>.sock` in its state dir (`data/sockets/llm.sock`) or
on a port of its loopback, `"to": {"here": true, "socket": "sockets/llm.sock"}`. Each is a
forward ([Forwards](#forwards)) with `service` naming the program:

```json
"services": [
    {"name": "llm", "type": "shell", "remote": "server", "cwd": "/home/user/llm", "command": "sg render -c './llama-server -m model.gguf --host 127.0.0.1 --port 8080'", "policy": {"start": "always", "restart": "always"}}
],
"forwards": [
    {"label": "llm → laptop", "service": "llm", "from": {"remote": "server", "port": 8080}, "to": {"remote": "laptop", "socket": "~/.sockets/llm.sock"}}
]
```

They stay with the program: a new name carries them, a move to another machine brings the port
from there, and **Remove…** takes them out with it (`DELETE /api/v1/services/<name>` answers
`"forwards_removed": [...]`, their labels). Its page says where its port is, with each forward's
state as Forwards shows it. A forward does not wake a program that sleeps: one with an address
starts with serviceman for its port to be there. Programs send the same as the page,
`{"service": {...}, "forwards": [...]}` to `POST /api/v1/services` or `PUT
/api/v1/services/<name>`: the list takes the place of the forwards that are part of it, and left
out leaves them as they are.

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
no reason to notice. **Fetch again**, under **⋯** on its page (`POST /api/v1/services/<name>/update`), is how
you say so: it stops the service whatever it is doing, runs the `update` line, or the `install`
line in an empty folder when there is no `update` line, and starts it again if it was running,
starting or failed. Nothing starts it while the line runs: a restart it was waiting for is
called off, and a request that wakes it waits for the line to end.

Nothing else about the service moves. It keeps its name, its address, its folder — the name of
that folder is made from the service's name, not from a moment in time — and its storage, which
is a folder of its own beside it, never inside what an install empties. Which is to say: after
a `git clone` install line runs again, the working copy is new and `data/<service>/…` is
exactly what it was.

Whatever serviceman gave up on before is forgiven at that moment: a service that had used up
its start attempts gets them back, because this is a different program now.

### A new version of an app folder

An app folder (`bin/run` in a folder named in `cwd`, as **An app folder** on the New service
form makes one) takes a new version the two ways it was made: **New version, a folder…** or
**New version, a zip…**, under **⋯** on its page, in place of **Fetch again**. **`data/` is the service's working space, never merged
or overwritten:** what the app keeps lives there, and it is all that outlives a new version:

1. the page reads the folder or the zip and sends its files beside the folder, to `<folder>.new`,
   as soon as it is picked: the browser's pick is the only ask. One that is no app (empty, with
   no `bin/run`, holding links) is said on the page, and nothing is sent;
2. serviceman stops the app, whatever it is doing: running, starting, or failed and waiting to
   be started again;
3. it sets the folder aside as `<folder>.old` and puts `<folder>.new` in its place;
4. `data/` is moved over from the old folder, over any `data/` the new files brought, and the old
   folder goes;
5. `bin/configure`, then `bin/build`, run in it, for those of the two it holds;
6. the new version starts, whatever the app was doing before.

`data/` is the app's alone, and a new version's own `data/` never reaches it: a folder picked
from a working copy holds that computer's saves, keys (a `settings.json`) and `data/logs/`,
which have no place in the running app. The page does not send it at all: it stays on your
computer, and the bar says how many files it held. What the app ships (presets, templates,
assets) goes in a folder of its own beside `bin/`, which every new version replaces; an app
with no `data/` yet makes its own. Files put in `<folder>.new` some other way meet the same rule
at step 4: a `data/` among them is taken only by an app that has none, and otherwise left out,
which the answer and the log say as `data_dropped`.

Nothing starts the app from step 2 until step 6: a restart it was waiting for is called off,
a request that wakes it waits and gets the new version, and a second new version is refused
until this one is in. `bin/run` never meets a folder whose `bin/configure` has not finished.

There is no way back once the folders are swapped. A new version whose `bin/configure` or
`bin/build` fails stays in place, with `data/` in it, and is not started: the app shows as
failed, with what the step said, and a request is answered with that, until **Start** runs it
as it is or another new version comes. Only a swap that cannot be made (the folder will not
move) leaves the old version where it was, stopped until something wakes it.
`POST /api/v1/services/<name>/replace` is step 2 onwards, for whoever put the files there; it
answers once the new version has started, or with what failed.

**From a script, all of it in one call:** the zip as the body of a `PUT`, with the owner's token
or one with the `versions` right on the app's machine ([a token for every caller](deploy.md#a-token-for-every-caller)).
The service's page shows this line, and **Make a token for …** there makes a token kept to that
service alone, to be copied once with the line filled in (the page draws the token as dots):

    curl -T ai-lab.zip -H "Authorization: Bearer $TOKEN" https://serviceman.example.com/api/v1/services/ai-lab/zip

serviceman reads the zip as the page does (one top folder, or `bin/run` at the top; its `data/`
left out and counted), sends its files to `<folder>.new` and goes on from step 2. The zip is
written to a file in the temp dir as it comes and read from there a file at a time, so its size
costs disk, not memory: a zip of 400 MB takes some 50 MB while it goes. A zip64 (above 4 GiB, or
more than 65535 files) is read as any other. A sender that hangs up (Ctrl+C on `curl`) stops it while the
zip is checked or sent to the machine: the app stays as it was, and the next zip goes at once.
From the swap on it goes to the end, since a folder swapped and not set up cannot start. It answers
when the new version runs: `200` with the service as the page shows it, `data_files` how many
files of the zip's own `data/` stayed out, `files` and `bytes` what went. What fails is said with
its status: `400` for a zip that is no app, broken, or not a zip at all, `403` for a token that
does not see the machine or is kept to other apps, `409` when the app is busy (another zip on its way
included: one goes at a time) or a `<folder>.old` is left from before,
`413` for a zip above 64 GiB, `507` when serviceman's disk has no room for it, and `502` when `bin/configure` or `bin/build` failed, the new
version then in place but not set up, as on the page.

An app folder's `data/` is its working space and its storage, with nothing to set: **Storage** lists it beside
what other services keep, and nothing but a person removes it. What the app writes to
`data/logs/` goes to Logline wherever its machine sends its lines there: the agent reads every
file in that folder, from the first line once the app makes it, and the lines carry the app's
name as `service`, so **Logs in Logline** on the app's page shows them with the rest of its
lines. The app's **Storage** card says where they go, or why they stay on the machine.

A service's **Logs in Logline** shows the lines of the machines its config names and no other's:
`service` is a label a machine writes as it likes, and `remote` the one Logline writes from the
machine's token, so a machine cannot put its lines under a service it does not run. A service
run here, with no machine named, is shown by its name alone.

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
token. The **Secrets** page, in the first crumb's menu, holds a *library* beside them — values written down once,
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
    "image": "node:26-alpine",
    "publish": {"host": "google-docs-writer.example.com", "port": 8090},
    "command": "bin/run",
    "lifecycle": {"install": "npm install"}
}
```

With an `image`, every line runs **inside a container of that image**, with the program's folder
mounted at `/app` and `/app` as the working folder. The install line becomes

    docker run --rm --volume <folder>:/app --workdir /app node:26-alpine /bin/sh -c "npm install"

and the program itself becomes a container of serviceman's own, published like any other:

    docker run -d --name serviceman-google-docs-writer --label serviceman.service=… \
        --volume <folder>:/app --workdir /app --publish 127.0.0.1::8090 \
        node:26-alpine /bin/sh -c "bin/run"

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
reads it while the program comes up. When it ends, its last lines come to serviceman with the
word that it ended, so its page says why, a program that ends at once too. The agent stops the whole process group, so a shell line
takes its children with it.

serviceman stops none of its programs when it stops itself: a program goes on running on its
machine, as a container does, and the next serviceman takes it back when its agent dials in,
as old as it was, a program with no port too. A restart of the agent touches none of them
either: a program goes on running, and the agent that starts next takes it back by the note the
one before it left, with the last of what it printed. So a program is stopped by stopping its
service; restarting serviceman or its agent does not stop it.

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

**A Stop by hand holds.** A service you stop (its Stop button, or
`POST /api/v1/services/<name>/stop`) is started again by nobody but you: not when its definition
is saved, not when its machine dials in, not when serviceman starts, until you press Start,
Restart or Update. serviceman keeps those names in `data/held.json`, and the page says
"stopped by hand: only Start starts it again". A save never starts a service that was stopped:
a changed definition takes the old one's place as it was, running or stopped. A service that
starts at the first request still wakes on a visit, as its policy says.

`restart` is `on_failure` (a bad exit code brings it back), `always` (any exit brings it
back) or `never`. serviceman waits a second before the first restart and doubles the wait
up to thirty seconds; a program that ran half a minute starts that count again. It applies
to programs — a container is restarted by docker, through `run_args`. Stop, or taking it out
of the config, in that wait calls the restart off (`program_restart_cancel`); a start of any
kind in it is the restart.

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
    "remotes": ["vps1"],
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
| `databases` | The databases it picked in its Data tab, each one variable of its env: [an app picks one](databases.md#an-app-picks-one). |
| `folders`  | The folders it picked there, `[{"path": null, "env": "FILES_DIR"}]`, `null` for one kept for it: mounted at `/data/files` (an app's **Data** tab, below). |
| `init`     | `false` leaves docker's `--init` out, for an image that has to be pid 1 itself — one built on s6-overlay quits otherwise. Default `true`. |
| `run_args` | Anything else for `docker run`, written as a list. |
| `args`     | The command line for the image itself.             |

serviceman runs `docker run -d --name serviceman-<name> --label serviceman.service=<name>
--publish 127.0.0.1::<port> ...`. Docker picks the host port, serviceman reads it back with
`docker port`, so two services never fight over a number.

**Pull the image again**, under **⋯** on the service's page, fetches the image again. A tag is not a version — `:latest`, or
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
| `upstream` | Where it already answers, as `host:port`. Plain HTTP. Required, unless `socket` is given. |
| `socket`   | Instead of `upstream`: the socket file it listens on, from `/` or `~/`. |
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

### Something listening on a socket file

With `socket` in place of `upstream`, its program listens on a socket file, and serviceman passes
every request into that file: on the machine `remote` names, through its link as a forward carries
a connection, from `/` or `~/` (`~` the home of the user the agent runs as there); or, with no
`remote`, on serviceman's own side, where a path from neither is inside serviceman's state folder,
as a forward's socket that lands there is: `sockets/agency.sock` is `data/sockets/agency.sock`
under `bin/run`, the folder its container shares, and every card says it so. Its folder there is
made by serviceman, owned as `data/` is, so the program can listen in it at once. A machine's door
hands its names to serviceman, which carries them in. This is what **Apps** adds as **An app on a
socket**.

```json
{
    "name": "agency",
    "type": "external",
    "remote": "laptop",
    "publish": {"hosts": ["agency.apps.example.com", "agency.localhost"]},
    "socket": "~/agency.sock"
}
```

Until the program listens there a visitor gets 502, and the address answers the moment it does.

It is never started, never stopped, never reaped — **Start** and **Stop** are refused, and
only its cards are left on the control page. `publish` is
the address it answers on here; there is no `publish.port`, because nothing has a port
*inside*. When it stops answering a visitor gets 502 and the address stays as written, since
there is nothing serviceman could restart.

## type: files

```json
{
    "name": "notes",
    "title": "Notes",
    "type": "files",
    "publish": {"host": "notes.example.com"}
}
```

A folder of files, a page or an app with no server of its own: serviceman reads them the
moment they are asked for, and nothing is started, stopped or put to sleep. Any address the app
keeps for itself that names no file (`/notes/42`) is answered with its `index.html`, so a page
reloaded where it left off is the page again; an address that names a file that is not there
(`/app.js`) is a 404. Nothing outside the folder is read. On a path of a shared name
(`tools.example.com/notes`) its files are served from that path down, its folder holding them
at its root.

| Field    | What it is                                                                                  |
|----------|---------------------------------------------------------------------------------------------|
| `folder` | Where its files are, read from the config's own folder. Optional: without it they are kept by serviceman, in `apps/<name>` of its state folder. |

There is no machine, no port and no copies: it is served by serviceman itself. On a machine's
door ([Remotes](remotes.md)) its name is handed to serviceman as any other. **Start** and
**Stop** have nothing to do, and it has no log of its own.

### An app sent to serviceman

An app of files goes in as a zip of its folder, with one call, through the control socket or the
control port, with the owner's token or one given the `apps` right
([a token for every caller](deploy.md#a-token-for-every-caller)):

    curl -T notes.zip -H "Authorization: Bearer $TOKEN" --unix-socket data/serviceman.sock http://localhost/api/v1/apps/notes

A token kept to the apps it makes sends a new name and the names it made, and is refused any
other with a `403` that says so; `GET /api/v1/apps` answers the apps it may send to, each
`{name, kind, address, public}` ([Apps from a coding agent](mcp.md#the-token)). A token given
`apps_read` alone lists every app and sends none.

**On serviceman's page** it is one drop: **Apps** has a card to drop the zip, the folder or one
`.html` page on (or click and pick a zip or a page), named after the file, `My Notes.zip` as
`my-notes`, `2.html` as `2`. The card answers with the link that opens the app here and Open, and
the name it has outside; under it, every app as a cell, a click opening it, and a search box over
the cells (**Finding an app**, below). A folder dropped is
zipped in the page and sent the same way, and so is a page, as the `index.html` of an app of its
own. What is none of them is said on the card at once, for what it is (`photo.png: it is a PNG
picture, not a zip`, a zip cut short, several things dropped at once), and nothing is sent;
serviceman says the same of a body that is no zip.

**Apps** shows every service as a card that opens it at its address, whatever runs it: the apps
that run from a folder of their own, as the New service form makes them ([a new version of an app
folder](#a-new-version-of-an-app-folder)), a program run as `bin/run` in its folder, here or on a
machine; a docker image, a program, something already running. **New version…** and a drop on the
card are for a page and an app folder, the kinds that take one; the own port and the names under
the apps domain stay theirs and an app on a socket's.

**An app on a socket**, in the drop card on **Apps**, adds one whose program listens on a socket file
([something listening on a socket file](#something-listening-on-a-socket-file)): its name, where
its socket is, serviceman's own `data/` folder (chosen as it opens) or a machine, and the file,
`data/sockets/<name>.sock` or `~/<name>.sock` there unless another is typed. It answers at once at
the names an app gets, the card saying the file to set the program to, with **Copy**, and that it
waits for the program: the program makes that file when it starts listening (serviceman makes only
its folder), and until then the address answers 502. Its cell says the file the same way and has **Copy socket** in place of
**New version…**; its **Settings** change the socket too. The same through the control door, with a token given the `apps` right:
a token puts an app on a machine it sees alone, and at the socket named after the app, `~/agency.sock` there or
`data/sockets/agency.sock` on serviceman's side, since a visitor of the app's names is passed into whatever listens on that
file; any other file, `/var/run/docker.sock` say, is the owner's to name, and refused to a token (`403`).

    curl -X PUT -d '{"socket": "~/agency.sock", "remote": "laptop"}' -H "Authorization: Bearer $TOKEN" --unix-socket data/serviceman.sock http://localhost/api/v1/apps/agency/socket

A cell is its app's: **New version…** picks a zip or a page for it, and a zip, a folder or a page
dropped on the cell goes the same way, as that app's new version whatever the file is called. An
app of its own folder takes a zip or its folder, never a page: it goes in as its page's **New
zip…** puts it, its `data/` kept as it is on its machine, and the cell says once it runs.
**Settings** opens a small window over Apps with its name, its **Sign-in**, one of the walls or
none ([behind a wall at every address](#behind-a-wall-at-every-address)), and its public addresses,
the names a machine's door answers for it, and nothing more; one Save writes them all, Cancel or Esc nothing, and
the rest of the service is on its page, linked at the window's foot. A new address goes through
the door that answers most names already, behind `authwall` where there is one.

Its **Data** tab, beside **Settings**, is what the app is given, a row each, every row one
variable of its env. **+ Database** picks a database of the [Databases](databases.md) page on the
app's own machine, `DATABASE_URL` unless renamed: it is written into the app's config as
`databases` and handed to it at every start as its own user's URL, an Adminer opening on it
logged in ([an app picks one](databases.md#an-app-picks-one)); a CouchDB comes as its admin,
`COUCHDB_URL` with `COUCHDB_SECRET` beside it ([for a wall's users](databases.md#couchdb-for-a-walls-users)).
**New database…** opens [New database](databases.md#new-database) with the app ticked.
**+ Folder** is a folder kept for it, in the agent's `data/<app>/files` on its machine, or a folder of that machine typed as a full
path, never one of the system's own, made when it is not there: written into the config as
`folders`, `FILES_DIR` unless renamed, it is mounted at `/data/files` (`/data/files-2` for a
second) for an app in a container and its variable says so, and a program on the machine finds
the folder's own path. **+ REST** is a sketch for now, kept in the browser that set it:
`REST_URL`, its documents kept by serviceman. A name can be changed (`DB_URL`), and two rows
never take one unasked (`DATABASE_URL_2`). A page takes REST alone, at its own `/_data/`; an app
serviceman does not start is handed no database and no folder. **Remove** goes at once, with
**Undo** in its place.

A new name takes the addresses made of its name with it (`notes.localhost` is `wiki.localhost`,
`notes.apps.example.com` is `wiki.apps.example.com`), and an app of files its folder in `apps/`;
an address added by hand stays, and so does a folder the config names. The door rules that answer
for it, or put it in front of another as its wall, its secrets and the tokens kept to it go with
the new name too, on any service renamed; what ran under the old name is stopped, never
uninstalled, and the new name starts it on its first visitor. A name another service has is a
`409`, and so is one whose folder an app of that name left in `apps/`.

A name serviceman has not seen becomes a folder of files in the config and is served at once:
`201`; a known one gets the new version: `200`. A new app has two names. One is beside
serviceman's own, `notes.localhost` beside `serviceman.localhost`, as the New service form names
a service, and the computer serviceman runs on reaches it with no DNS to change: a name under
`.localhost` is that computer, in a browser and in its own resolver, and serviceman answers it
to that computer alone, never to the tailnet or a machine's door
([the image's doors](deploy.md#serviceman-in-a-container-with-tailscale-inside)). The other, once the config
has an apps domain, is under it, for outside:

```json
"apps": {"domain": "apps.example.com"}
```

`notes` then answers on `notes.apps.example.com` too. An app made before the domain gets its name
under it when the **Config** page saves the domain, written into its addresses as a new one gets it;
a domain moved takes the old names away and writes the new ones, and a name another service answers
is left to it. The answer says both: `address`, where it
answers here (`http://notes.localhost:8080/`), and `public`, its name outside (`null` with no
domain). A `_` in a name is a `-` in its addresses.

The zip is the app's folder, or one folder holding it, with its `index.html` at the top. Every
file of it goes, a `data/` too: nothing runs in a folder of files to keep one of its own. Its
files are written beside its folder and put in its place whole, so a visitor meets the old
version or the new one, never half of each; a zip that is broken, holds links, leads outside its
folder or has no `index.html` is a `400` and changes nothing. One app takes one zip at a time
(`409` for a second), and a name that is a service of another kind is a `409` too: a new
version of an app folder goes to `/api/v1/services/<name>/zip`.

From outside, one rule on a machine's door answers every app under the domain, each at its own
address, the sign-in in front: `"*.apps.example.com": {"service": "*", "auth": "authwall"}`
([A machine that takes the traffic](remotes.md#a-machine-that-takes-the-traffic)).

**The page of cells** is the domain itself, `apps.example.com`: a cell for every service whose own
address is under it, an app sent to serviceman or anything else published there, by name, each
with its state (running, asleep, starting, failed) and opening it on a click, on the port the page
was asked on. serviceman answers it on its own door, and through a machine's door where a rule
gives the bare name to `"*"` too, the pattern covering only the names under it:

```json
"inbound": {"*.apps.example.com": {"service": "*", "auth": "authwall"}, "apps.example.com": {"service": "*", "auth": "authwall"}}
```

**Every app on one page,** to type in a browser: `http://apps.localhost:3000/` on the computer
serviceman runs on, and serviceman's own name on the tailnet, `http://serviceman.tail1234.ts.net:3000/`,
on every device of it (its first word, `http://serviceman:3000/`, where MagicDNS is on, or its
tailnet address). A cell for every service, by name, with its state, opens it the way that browser
reaches it: at its name on this computer (`notes.localhost:3000`), at its own port on the tailnet
(`serviceman.tail1234.ts.net:3400`, below); one with no port of its own there, a docker image
say, or whose port does not listen, says so and opens nothing; the same search box stands over its
cells. `apps` is `apps.` and the rest of
serviceman's own name, as an app is named (`apps.example.org` beside `serviceman.example.org`). A name a service has is that service's,
and the page answers only at `/`. Through a machine's door neither name is a page: there only
the domain's is, where a rule gives it (above). **Apps** says both addresses on top, each with
its **Copy**.

**Finding an app.** The search box over the cells on **Apps** and on the page of apps finds as
navplace's does. What is typed narrows the cells to the apps that have it in their name, their
kind (`page`, `app folder`, `socket`) or their address, those found by name first; a letter typed
anywhere on the page goes to the box. ↑ and ↓ move the outline among the cells found, and Enter
opens the outlined one as a click on it does. Each word is a search of its own: the cells show
the last word's, and Enter opens the first app of every word before it too, `notes mail` both.
Inside a word `/` joins parts that must all hold (`app/laptop`), `^` and `$` hold a part to the
start or the end of a name, and `!` turns a part around (`app/!laptop`). Upper and lower case are
the same, and Cyrillic letters are found by Latin ones, `pochta` finding Почта.

**The page and every app behind a wall:** one list in the card **Settings** opens on **Apps**,
**This page and every app**, under those addresses, puts the page of apps and every app behind the wall picked, an app
sent tomorrow too. The page asks it first on each of its names, and `/auth/…` there is the wall's
own, so the sign-in comes up on the name you typed; each app asks it at every address it has, as
its own pick would ([behind a wall at every address](#behind-a-wall-at-every-address)). An app
with a wall of its own keeps that one, and the wall itself is never put behind itself. While one
is picked there, an app with none of its own says "as every app" in its **Settings**; back to
open, each app is as its own pick says.
Through a machine's door, a rule that names a wall keeps it. In the config it is one field,
the name of the wall's service:

```json
"apps": {"auth": "authwall"},
"services": [
    {"name": "authwall", "type": "external", "publish": {"host": "authwall.localhost"}, "upstream": "127.0.0.1:3200"}
]
```

The same through the control door: `PUT /api/v1/apps` with `{"auth": "authwall"}`, or
`{"auth": null}` for none.

**On your tailnet, with nothing to set up:** every app has a port of its own on serviceman, so
every device of the tailnet opens it by serviceman's tailnet name, `notes` at
`http://serviceman.tail1234.ts.net:3400/`, with no domain, no DNS and nothing typed in Tailscale's
admin. **Apps** shows each one's link on its card, under **tailnet**, and its **Settings** the whole
address. Whatever name a request on that port carries, it is that app's, behind the wall the app
stands behind, and nothing else is reached there: no other service, never the control page.

```json
"apps": {"ports": 3400}
```

**Over https, on the tailnet's certificate.** Where tailscale runs beside serviceman, as in the
image, serviceman asks it for the certificate of its tailnet name (`tailscale cert`) at the start
and once a day after, keeps it in memory, and every app's own port answers https with it:
`https://serviceman.tail1234.ts.net:3400/`, a websocket as `wss://`. A page there is a secure
context, so the browser lets it use the microphone, the camera, screen recording and the
clipboard. The same port answers plain http too: a program is answered where it asked, and a
browser's page visit by serviceman's tailnet name, its first word or its tailnet address is sent
on to https (`307`). **Apps**, **Addresses** and the page of apps link the https address. The
tailnet gives certificates once HTTPS is turned on in its DNS settings, in Tailscale's admin;
until then, or with no tailscale, the ports answer http as before, and the log says why
(`tailnet_cert_error`, [Logs](logs.md)). Where tailscale refuses one, **Health** has a card with its
reason and what mends it ([When something is wrong](remotes.md#when-something-is-wrong)), and the
bar on every page says it too, from its second check on, a minute after a start; HTTPS off for the
tailnet comes with a link to Tailscale's DNS page, where it is turned on. **Apps** and
**Addresses** say it at once, in a note over their tailnet links, with tailscale's own words and
that link; each app's tailnet link says it is http and why, wherever it is shown: **Apps**, an
app's **Settings**, **Addresses** and the page of apps.

**Or said on the Tailscale page alone.** **Say that the apps' tailnet links are http** on the
Tailscale page, set off (`"apps": {"http_said": false}`; `PUT /api/v1/apps` with
`{"http_said": false}`), says it there alone, in a line beside the switch with the link to
Tailscale's DNS page: Apps and Addresses show no note, no tailnet link says http, the page of apps
says nothing of it, and neither Health nor the bar lists or counts it. The links stay as they are,
over http; the log says why as before. Set on, every page says it again at its next look, with no
restart.

**Or by `localhost`, with no certificate.** A computer that runs the agent opens an app as a
secure context through a forward on its own loopback, `http://notes.localhost:5460`, which its
agent joins straight to the app's port here: nothing goes into the public log of certificates,
and nothing passes through serviceman ([Both ends on one machine](remotes.md#both-ends-on-one-machine)).
A phone runs no agent, and is left with https.

**Or off the tailnet, by localhost alone.** **On the tailnet** in Apps' **Settings**, set off, gives the apps
no port of their own (`"apps": {"ports": null}`; `PUT /api/v1/apps` with `{"tailnet": false}`):
no device of the tailnet opens one by serviceman's name, the page of apps is not answered there,
no certificate is asked of tailscale, so serviceman's name goes into no public log, Health warns
of none missing and the Tailscale page says none is wanted, and Apps and Addresses show no
tailnet link. A machine with an agent opens them by localhost through a board
published on it ([App boards](#app-boards)); a device with no agent, a phone, opens none. Set on,
they have their ports again.

**The Tailscale page,** on All categories, shows everything serviceman does with tailscale in its image,
in three cards: on the tailnet and by what name, with its address, tailscale's version and the
way out to the tailnet (tailscale's proxy, or straight), or the link to sign this machine in while
tailscale waits for one; the certificate, until when and for which name, or why there is none and
what mends it; the names of the apps it answers on the tailnet (`apps.dns`). Above them, the
switch above, while the apps are on the tailnet. Under them, the last 50 calls serviceman made to
tailscale as a table card, each with how long it took and what came back, never what it printed. It asks tailscale
when it opens and on **Refresh**, and with no tailscale, outside the image, it says so.

`ports` is the first of them, `3400` unless said (3100 is Loki's); `null` gives none. A new app takes the lowest one
free from it up, past serviceman's own ports, and keeps it: it is written in `app_ports.json` of the
state folder, the same after a restart and after other apps come and go, it follows a rename, and an
app taken out lets it go for the next new one. Each listens where the service port does
(`listen.host`): in the image the tailnet reaches every port of it, and `bin/run` publishes only
3000 and 3001 on this computer ([the image's doors](deploy.md#serviceman-in-a-container-with-tailscale-inside)). One another program
holds is said on the app's card and in the log, and tried again every minute. Beside a
`listen.port` of `0`, the apps' ports are `0` too, whichever is free, kept nowhere.

**On your tailnet, by name,** with no DNS server of your own: with `dns`, serviceman answers the domain's
names on that UDP port, the domain itself and every name under it, each with this machine's
tailnet address, and refuses any other name.

```json
"apps": {"domain": "apps.example.com", "dns": 53}
```

The address is what `tailscale ip -4` says, asked until it says one (the image has tailscale), or
`address`, `100.64.0.20`. Then one setting in Tailscale's admin console: **DNS**, **Add
nameserver**, **Custom**, serviceman's tailnet address, **Restrict to domain** `apps.example.com`.
Every device of the tailnet then opens `http://notes.apps.example.com:3000/`, serviceman's own
port, which the tailnet reaches in its container, and the page of cells at
`http://apps.example.com:3000/`; nothing of it is reached from outside the tailnet. **Apps**
leads with that link once `dns` is set. A change of `dns` or `address` waits for a restart.

### A PHP file

One `.php` file dropped on **Apps**, `adminer.php` say, is an app that runs on a machine of yours:
a small window asks its name and the machine, one that is online with docker. serviceman puts an
app folder of its own in the agent's services folder there, the file and a `bin/run` that serves
it with PHP's own server, every request going to the file, and runs it in `serviceman-php:8.4`:
the official `php:8.4-cli` with the drivers of MySQL and PostgreSQL (`mysqli`, `pdo_mysql`,
`pgsql`, `pdo_pgsql`), made on that machine through its docker the first time a PHP app starts
there, a minute or two. An Adminer's folder holds its login too: given a database in its Data
tab, it opens on it ([Adminer](databases.md#adminer)). The same through the control door, the
owner's alone:

    curl -T adminer.php -H "Authorization: Bearer $TOKEN" --unix-socket data/serviceman.sock "http://localhost/api/v1/apps/adminer/php?remote=laptop&file=adminer.php"

In the config it is a program in that image, an app folder, which takes a new version as every
app folder does:

```json
{
    "name": "adminer",
    "type": "shell",
    "remote": "laptop",
    "image": "serviceman-php:8.4",
    "command": "bin/run",
    "cwd": "/home/user/serviceman-agent/services/adminer",
    "publish": {"host": "adminer.localhost", "port": 8080}
}
```

### A file browser

**A file browser**, in the drop card on **Apps**, puts serviceman's own File Manager on a machine of yours, as an
app folder of its own, over one folder there: a folder kept for it, or one of that machine typed
as a full path, never one of the system's own. It opens on that folder, which it shows as `/` and
never leaves, and is that folder's first row in its **Data** tab, `FILES_DIR`. It is a program run
by node, which the agent runs on, on the first port from 8080 that no program of serviceman's is
given and the machine does not listen on. Whoever opens it can read, change and delete what is in
the folder: put it behind a wall in its **Settings**. The same through the control door, the
owner's alone, `null` for a folder kept for it:

    curl -X PUT -d '{"remote": "laptop", "path": "/srv/photos"}' -H "Authorization: Bearer $TOKEN" --unix-socket data/serviceman.sock http://localhost/api/v1/apps/photos/file-browser

### App boards

A board is a page of apps put together by hand and published on machines. On each, its agent
answers it on `127.0.0.1` and nowhere else: the board at its name under `.localhost`, each app
on it at its own, `http://apps.localhost:3000/` and `http://notes.localhost:3000/`. Nothing on
the network that machine is on, its tailnet included, reaches the port. A page there is a
secure context, so it has the microphone, the camera and the clipboard with no certificate.

```json
"boards": [
    {"name": "apps", "machines": ["laptop"], "apps": ["notes", "mail"]}
]
```

| Field      | What it is                                                                     |
|------------|--------------------------------------------------------------------------------|
| `name`     | Its name under `.localhost`: lowercase letters, digits and hyphens.            |
| `machines` | The machines it is published on, by name; none yet is a board on no machine.   |
| `apps`     | Services by name, in the order the board shows them.                           |
| `port`     | Where its agent answers it, on `127.0.0.1`: `3000` unless said.                |

**Boards**, on All categories, is where they are made: a table of boards, a row each with its apps,
the machines it is published on, its address and whether it is published, a draft or on a machine
that is away, and a palette of every app beside it. An app dragged onto a board's row is put on it,
last. A click on the row, or its **⋯**, opens the board's window: its apps there are moved by
dragging and taken off with ×, a machine clicked publishes it there, its name changes, and
**Remove…** takes it away. Each change is saved at once. A program reads the list with
`GET /api/v1/boards` and writes it back whole with `PUT /api/v1/boards`, the owner's token alone.

- **Straight to the app.** A request on a board's port is routed by the machine's door table, as
  its door routes one ([A machine that takes the traffic](remotes.md#a-machine-that-takes-the-traffic)):
  a service on that machine is reached there, one on another machine through that machine's
  agent over the tailnet, and an app serviceman serves itself, and the board's page, over the
  machine's link to serviceman, one trip. An app's wall is asked as at any of its addresses.
- **One name, one thing.** On one machine a name under `.localhost` is one board or one app; the
  config refuses two boards or a board and an app that would share one. An app on two boards of
  one machine is the same name.
- **Renamed or deleted.** A renamed app keeps its place on every board it is on; a deleted one
  comes off them.
- **An agent older than 1.40** listens on no board's port: update it.

## Load tests

A load test sends [k6](https://k6.io/) at a service: a number of users asking for one address
for a while. The **Load tests** page makes them, runs them and keeps what each run measured; this
is the list it writes. **New test** asks step by step, or on one page: **Target**, the service
and its address; **Load**, the users, for how long, and the machine it runs from; **Passes when**,
the 95th percentile and the share of errors; **Check**, with its name.

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
