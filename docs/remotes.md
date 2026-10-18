# Remotes

A remote is a machine that carries services for this host — a VPS, or the very machine
serviceman runs on. It runs `serviceman-agent`, which dials this host and waits for orders.
serviceman never dials out, so the machine needs no open port, no public address and no key of
yours — a box behind NAT works.

serviceman itself starts nothing: every container and every program is the work of an agent.
A `docker` or a `shell` service names the remote it runs on, and a config with no remote can
serve folders of pages and give addresses to what already runs, and nothing more.

The address stays here. `grafana.example.com` still points at the serviceman host; the
container runs on the remote, and every request rides back through the link the agent
dialled. The visitor sees no difference.

## Add a remote

**+ Add remote** on the control page asks for a name, makes the token for you, and writes it
to the config. The remote appears under **Remotes** at once — offline, with the two ways to put the
agent on that machine, filled in with its name, this host's address and its token.

By hand it is the same thing, with a secret of your own:

    openssl rand -hex 32

```json
"remotes": [
    {"name": "vps1", "title": "Example VPS", "token": "0c0f…a91b"}
]
```

## Put the agent on the machine

Three ways to the same agent. It needs node and nothing else — no npm install, no build.
On a machine with no node, the install line says so before anything else, before the
password `--root` asks for, and prints the command that puts node, one file, in `~/bin`; the
same install line run again finds it there.

### One file

```
curl -fsSL https://serviceman.example.com/api/v1/agent.js -o serviceman-agent.js
node serviceman-agent.js --url https://serviceman.example.com --token 0c0f…a91b
```

**The token is the whole introduction.** serviceman looks up the remote that holds it, so the
agent gives no name and cannot claim one it has no token for. One token, one machine: while an
agent holds the link, a second one on the same token is refused rather than taking it over.

serviceman builds that file out of its own modules every time it is asked for, so it can
never be out of date. To carry it over yourself instead, `bin/agent-bundle` writes the same
file here.

| Option     | What it is                                                              |
|------------|-------------------------------------------------------------------------|
| `--url`    | Where serviceman answers, or a socket file. `SERVICEMAN_URL`.           |
| `--token`  | The token of this machine. `SERVICEMAN_TOKEN`.                          |
| `--dir`    | The folder whose free space is reported. `SERVICEMAN_DIR`, default `/`. |
| `--docker` | The docker command on that machine. `SERVICEMAN_DOCKER`.                |
| `--once`   | Dial once and exit when the link drops, instead of dialling again.      |

### An image

```
docker build -f Dockerfile.agent -t serviceman-agent .

docker run -d --name serviceman-agent --restart always \
    --network host \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /:/host:ro -e SERVICEMAN_DIR=/host \
    -e SERVICEMAN_URL=https://serviceman.example.com \
    -e SERVICEMAN_TOKEN=0c0f…a91b \
    serviceman-agent
```

The image is the one file on `node:24-alpine`, with a docker client beside it. Three things
it needs from the machine: the **docker socket**, so it can run the containers it is asked
for; **`--network host`**, so it reaches those containers where docker publishes them, on the
loopback; and **`/` mounted read-only** with `SERVICEMAN_DIR=/host`, so the free space it
reports is the machine's and not the container's.

### From a copy of the repo

```
rsync -a --exclude node_modules --exclude .git ./ vps1:/opt/serviceman/
ssh vps1 /opt/serviceman/bin/serviceman-agent --url … --token …
```

## What the installer leaves on the machine

One folder, and everything about that machine's half is inside it — `/opt/serviceman-agent` as
root, `~/serviceman-agent` otherwise:

    agent.js       the agent, one file, node and nothing else
    servermon.js   the machine's load every second, written and kept running by the agent
    env            where the host is, and the token. Mode 600.
    status         what the agent is doing right now, rewritten every few seconds
    logs/agent/    the agent's log, one file a day: logs/agent/20260823.txt
    logs/servermon/  servermon's, a JSON line a second, one file a day: logs/servermon/20260823.jsonl
    services/      everything the host asked this machine to install, a folder each
    bin/install    puts it under systemd, or says how to run it. Safe to run again.
    bin/restart    starts it again — what a line added to env needs to take
    bin/uninstall  stops it and takes it out of systemd
    README.md      the same, on the machine, for whoever finds it there

**Not root, it is kept up by your own systemd,** and the one install line does all it takes.
Your systemd runs only while you are logged in unless lingering is on, so `bin/install` turns
lingering on first, asking for the sudo password once when you may not do it alone. A shell
opened with `su` or `sudo` has no `XDG_RUNTIME_DIR`, so `systemctl --user` there finds no bus;
the scripts look for it at `/run/user/<uid>` themselves. With no sudo either, it says what to
run as root and writes no unit: `loginctl enable-linger <you>`, then `bin/install` again.

`status` is for the moment the host is the thing that cannot be reached:

```
serviceman-agent 1.0.0 built 2026-08-23T11:32:17.607Z
pid 203911, up 4h 12m
machine laptop
host http://serviceman:3001
link online as remote laptop, for 4h 11m
programs
  writer#1 pid 204338 /opt/serviceman-agent/services/apps/writer
refreshed 2026-08-23T15:46:03.118Z
```

**Everything the agent makes stays under that folder.** A program the host installs here lands
in `services/<name>.<suffix>`, one folder per service, and a path that would leave `services/`
is refused. So the machine
is left as it was found: `bin/uninstall`, `rm -rf` the folder, and nothing of serviceman is
anywhere else.

## Newer agents find their way over

The agent says which build it is when it dials in, and this host knows the build it serves. When
they differ, the machine is asked to fetch the current one — it runs its own `bin/update`, which
is the same thing you would run there by hand.

That check runs when a machine dials in **and once a minute after that**, so a machine that has
been connected for a week hears about a newer agent too. A machine is asked again at most every
ten minutes: an update replaces the agent, so being asked twice for the same build means the
machine cannot update itself, and asking harder will not help.

    [remote_update_asked]     remote=laptop running=2026-08-20T09:11:02.318Z serving=2026-08-23T16:03:50.546Z
    [remote_update_refused]   remote=laptop reason="… is not here — this agent was not installed by the installer"
    [remote_update_not_taken] remote=laptop running=2026-08-20T09:11:02.318Z serving=2026-08-23T16:03:50.546Z asked=3

An agent that answers "started" and dials in again as the same build did not update, whatever it
said: each ask after that is `remote_update_not_taken`, and the machine's page says so under
Agent. An agent recent enough to know keeps what its `bin/update` printed in
`logs/update.log` and answers the next ask with it, as `remote_update_refused`.

`"agent_update": false` in the config leaves every machine as it is, to be updated by hand.

## Keep it up

`bin/install` does it — the system's systemd when run as root, your own systemd otherwise, with
lingering so it survives a logout. It is written by the installer with the paths already in it,
and running it again is how you pick up an edited `env` or a replaced `agent.js`.

Where there is no systemd, it says what to run instead:

```
env $(cat /opt/serviceman-agent/env | xargs) /usr/bin/node /opt/serviceman-agent/agent.js
```

With the image, `--restart always` does the same thing.

## A kind of machine, not one machine

A machine carries tags — what it *is*, written by whoever runs serviceman:

```json
"remotes": [
    {"name": "vps1", "token": "0c0f…a91b", "tags": ["gpu", "eu"]},
    {"name": "vps2", "token": "7a1b…33cd", "tags": ["eu"]}
]
```

and a service asks for a kind of machine instead of a name:

```json
{"name": "grafana", "type": "docker", "remotes": ["#gpu"], "image": "grafana/grafana:latest"}
```

`remotes` is still a list in the order it prefers, so `["vps1", "#eu"]` means *that machine if
it is up, otherwise anything in Europe*.

**A machine also says what it is.** The agent takes `--tag`, and what it says holds for as long
as its link does:

```
serviceman-agent --url … --token 0c0f…a91b --tag gpu
```

    [remote_online] remote=vps1 from=203.0.113.9 agent=1.0.0 tags=["eu","gpu"] machine=…

So a machine's tags come from two places: the config, which is the host's word and stands
whether the machine is up or not, and the machine itself, which is gone the moment it
disconnects. A machine written into the config holds a token of its own and is trusted with what
it says; a machine that **added itself** holds the fleet's join token, so it may only ever claim
what `join.tags_allowed` lists — on every link, not only the first.

Because a machine can say what it is at any time, a tag nothing carries **yet** is not a config
error. The boot says so instead, once per tag:

    [serviceman_tag_nowhere] tag=gpu service=grafana

which is also what a typo looks like — with the service reading *waiting for its machine* until
something answers.

## A machine that adds itself

The point of a tag is a machine you have not written down yet. One secret lets it join:

```json
"join": {"token": "0c0f…a91b", "tags_allowed": ["gpu", "eu"], "name_prefix": "auto-"}
```

```
serviceman-agent --url https://serviceman.example.com --token <the join token> --tag gpu
```

serviceman writes it into the config with a secret of its own, gives it the tags it was allowed
to claim, and it starts carrying every service that asks for `#gpu` — including services that
were waiting for a machine that did not exist when they were written.

    [remote_joined] remote=auto-box-17 machine=box-17 from=203.0.113.9 tags=["gpu"] refused=["secret"]

The line says what it claimed and what was dropped. **A tag in the config is a fact; a tag from
a machine is a claim** — only `tags_allowed` is honoured, because a machine that names its own
tags is choosing which of your work it receives.

The machine says which machine it is (`--machine`, the hostname by default), so the same box
coming back takes its own entry instead of leaving a dead one behind. That identity is worth
exactly as much as the join token: **whoever holds it can add a machine to your fleet and claim
the allowed tags.** Treat it as the password of the fleet, keep it out of images and shell
history, and leave `join` out of the config entirely when you do not need it — which is the
default.

## Run a service there

```json
{
    "name": "grafana",
    "type": "docker",
    "remote": "vps1",
    "publish": {"host": "grafana.example.com", "port": 3000},
    "image": "grafana/grafana:latest"
}
```

serviceman drives docker over the link — `run`, `start`, `stop`, `inspect`, `port`, `logs` —
and proxies the answers back through it. Everything else about a service works the way it does
here: the idle policy, the pool, the waiting page, and **Shell**, which
opens a stream to the docker socket over there and runs the exec through it.

A `shell` service names a remote the same way, and the agent runs the program as its own child.
Nothing is placed for you, and nothing moves on its own: a service runs where you write it.

## What the host knows about a remote

The agent says what the machine is when the link opens — hostname, cpu, memory, free disk,
docker version, node version — and repeats the numbers that move every 30 seconds: among them
how busy its cores were since the last time, which is cpu use as top counts it, beside the load
average, which counts what waits on disk and network too and so is no share of the cores. This host
pings the agent every 30 seconds for the delay, and sends a megabyte there and back every ten
minutes for the speed. All of it is on the control page, and in `/api/v1/status`.

The **Overview** tab shows a machine at a glance: its state beside its name, then tiles for CPU,
memory, disk and temperature, each with a bar under it (amber from 80%, red from 92%), and for
its battery and the link; its history, then cards for the machine, its agent, its services, its updates and its logs, each
with a link to the tab that does more with it, and its raw state folded away at the end.
It is `src/main/public/remote_overview.js`.

**History** is the machine's charts: CPU, memory, the space on all its disks together (as the remotes list counts it; the Disk tile is the one `/` is on), disk I/O, network, open tcp
connections and ping, over the last hour, day, week or month. The agent keeps the numbers on
its own disk, under `metrics/` in its folder, whether serviceman is there or not: a line every
30 seconds for two days, and five-minute averages for 90 days, a few megabytes at most. Ping is
the time from each of its beats to serviceman's answer. The page reads a range when it opens
and every half minute after, from `GET /api/v1/remotes/<name>/metrics?range=1h|24h|7d|30d`,
which asks the agent and keeps nothing but the last answer for each range: that answer is shown
while the machine is offline, marked with the time it was read. The minutes a machine was off
are a gap in its lines. The cursor runs through every chart at once, so a spike in one is read
against the others. An agent before 1.9 has no charts, and the pane says how to update it.

**servermon** is the same machine second by second, for the night it stopped answering: CPU and
steal, load, memory and swap, how long tasks waited for the CPU, memory and disk, every disk's
space and busy time, network in, out, drops and errors, open and half-open tcp connections,
connections refused at a full queue, the conntrack table, and pings to the gateway and to two
internet hosts. One JSON line a second into `logs/servermon/<yyyymmdd>.jsonl` beside the agent,
30 days kept, read on the machine with `tail` and `jq`. It is `src/servermon/servermon.js`, one
file with node and nothing else; the agent writes it into its folder and starts it on its own,
so a restart or an update of the agent leaves it running, and finds it again by its command
line. The agent looks every minute: one that is gone, an older text, or one silent for half a
minute is started again
(`servermon_begin`). `bin/uninstall` stops it. A machine whose agent keeps no log folder
(`SERVICEMAN_LOG_DIR` unset or `none`) has none, and `bin/status` says so.

One more thing its page reads on the spot and keeps nowhere. **Processes** is every process
on that machine, as the tree it is: each one under the one that started it, and a branch folds
away. Typing in its box keeps the processes whose command, user or pid match, with the ones
above them dimmed so each keeps its place in the tree; **Top CPU** and **Top memory** list them
heaviest first instead. It is `ps` run over there when the pane opens and when **Read again**
is pressed, never on a clock. The ports it listens on are in the **Firewall** tab, below.

**Packages** is every package dpkg has installed there, read the same way: its version, its
size, whether it was installed by hand or came along as another package's need, and — from
`apt-get -s upgrade`, a dry run that needs no root — the version an upgrade would bring, marked
when it comes from a security archive. Held and half-installed packages say so. The dry run
reads the lists the last `apt-get update` left, so "to update" is as fresh as those; the
Configure tab installs them.

An upgrade can restart Docker, and Docker does not bring back every container it stopped.
Before it starts, serviceman notes the containers that run; once it is over, it waits for
Docker to answer and starts again each one that is not running. What cannot start is named at
the end of the upgrade's lines, with Docker's reason, and on the Health page.

## Its ports and its firewall

The **Firewall** tab of a remote is what the machine listens on and what its firewall, ufw,
lets through. (It was two tabs, Ports and Firewall; an old `/ports` address opens it.)

**The ports** are everything the machine is listening on — tcp and udp, v4 and v6 — with what
is holding each socket, one row per port and holder, read with `ss` when the tab opens and when
**Read again** is pressed. Each says who its address lets reach it: the internet (a public
address, or every address of a machine that has a public one), a network (a private range,
link-local, or the tailnet's `100.64.0.0/10`), or this machine only (loopback). Beside it, what
the firewall does to it: let in by a rule, kept out by a rule or by the default, or, while the
firewall is off, what it will do once on. ufw goes by the first rule that matches, so that is
the rule named; a rule for one source only is said beside it ("kept out by the default, but
from 10.0.0.0/8"). **Allow** on a row adds a rule for that port; **Close** takes away the rule
that let it in, with Undo. The tiles count what actually gets through: a port the firewall
keeps out is counted as kept out, however open its address. A firewall in front of the machine
(a cloud's security group) is not seen from here.

`ss` names the holder of a socket only to whoever may read that socket, and the agent in a
person's session may read its own and no others — so the port list is asked of the machine's
root half where it has one, and every daemon on it is named. A machine with no root half, or
one whose root half is older than this, answers as the session agent: the same ports, with the
**Held by** column filled in for its own and empty for the rest.

**The rules** are ufw's own, on or off: its defaults, a row to add one, and × to delete one,
with Undo that puts it back at its old place. A rule that lets ssh in is asked for before the
firewall goes on without one; serviceman itself is never shut out, since its agent dials out.
ufw runs as root: in the machine's root half where it has one, else as `sudo -n ufw`, which
needs a sudoers line naming ufw. A machine without ufw says so; a root half older than the
firewall says it is updating. The module is `modules/firewall`, and its README has the API.

## Its encrypted volumes

An encrypted volume is one file on one machine's disk, LUKS with ext4 inside, opened at a folder
of that machine: a stolen disk or snapshot shows random bytes and a size. The **Storage** page
lists every machine's volumes under its folders: the folder, open or closed, how full, and what
the file takes on the disk. **Close** and **Grow** are in a volume's row; a close that something
still holds says what holds it, a process or a container, and closes nothing; a systemd
service's sandbox, which only sees the mount, holds nothing. **New volume…** makes one with a
passphrase you type, kept nowhere, and **Open…** in its row opens it again: you type it after
every reboot, and a lost one opens it never. A typed passphrase is hashed with argon2id at the
cost cryptsetup measures on the machine. Visual Agents makes and opens its own through the API,
with keys it holds. The work is the machine's root half's, and a key travels only over TLS, a
socket file, the same machine, a page loaded from this machine's `localhost` or the tailnet. The
module is `modules/volumes`, and its README has the API.

## When something is wrong

Every minute serviceman looks at everything it runs and knows, and the **Health** page, first
in the rail, shows what it found: one row per thing (a machine, a service, Logline and each
machine's lines, a forward), and one check per thing it does, green when it works, orange when
it works but wants a look, red when it does not, grey when there is nothing to say yet. What is
wrong comes first, one card each: where it is, since when, why, and what mends it; a red bar
under the page's header says so on every page and opens it. Its **×** puts it away once the
problems are seen, in this browser; a problem not seen yet brings it back, and the Health row
of the rail stays red meanwhile. A problem shows once it is seen
twice in a row, so a blip of a second is not one, and leaves on its own once it is mended. Each
is written to the log too, `problem_begin` and `problem_end` ([The log](logs.md)).

| It looks for                                       | How                                                                                                                  |
|----------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|
| A machine that was here and went offline           | Its link.                                                                                                            |
| A copy of a service that does not answer           | A request to it, the way a visitor's goes.                                                                           |
| A container Docker was meant to keep running, down | Its restart policy, and how it exited: a container stopped by hand is not one.                                       |
| A running container whose mounted files are gone   | Each bind mount looked for on the machine: it runs on what it holds open, and will not start again after a restart.  |
| Lines Logline does not take                        | What Logline answered the machine last, how long nothing went while lines wait, and how full the machine's store is. |
| Logline's viewer not answering                     | A request to it, the way Open Logline goes.                                                                          |

Health shows the rest beside them, said but not counted as problems, one table per part with a
column per check; a click on a row opens every check's detail under it. Logline's store counts as
working while the machines' lines are taken: its address is theirs to reach, and serviceman may
not be able to look it up.

| Check            | Orange or red when                                                                                     |
|------------------|--------------------------------------------------------------------------------------------------------|
| Agent            | It runs an older agent than serviceman serves, or will not update (it says why).                       |
| Disk             | Under 10% of the disk is free; red under 3%.                                                           |
| Memory, CPU      | Under 5% of the memory is free; the CPU is 90% busy or more.                                           |
| Updates          | Security updates wait, or the machine wants a restart after an upgrade.                                |
| Firewall         | ufw is installed and off. Asked every five minutes, one `ufw status`; grey where ufw is not there.     |
| Doors            | The machine did not take its door table.                                                               |
| Forwards         | A forward cannot listen, or one of its two machines is away.                                           |

## When the machine is away

| What you see                                               | What it means                                   |
|------------------------------------------------------------|-------------------------------------------------|
| `remote vps1: offline, the link held 4h 2m`                | The link dropped. The agent dials in again.     |
| `[remote_service_lost] service=kept remote=vps1`           | Its containers keep running over there.         |
| `502 remote vps1 is offline — its agent is not dialled in` | A visitor asked for a service on a dead remote. |
| `remote vps1: an agent dialled in with the wrong token`    | Someone knocked with the wrong secret.          |

A service on that machine reads **lost** while the link is down, not stopped: nobody stopped
it, and this host simply cannot see it. The address it last answered on is kept, and the page
says why.

The agent dials again after 1s, then 2s, doubling to 30s, for as long as it takes. When it
comes back, a container still running over there is adopted, not started twice, a container
that has gone becomes stopped, and a service with `"start": "always"` is started then.

## Dialling in over a socket file

An agent does not need a port at all:

```
node serviceman-agent.js --url unix:///run/serviceman-control.sock --token 0c0f…a91b
```

That is the same door the control page answers on (`control.socket`). Forward it and the machine
can be anywhere:

    ssh -R /run/serviceman-control.sock:/run/serviceman-control.sock vps1

Now the agent on that box dials a file, serviceman listens on nothing, and no port is open at
either end.

## Reaching this host

The service port is bound to `127.0.0.1` until the config widens it, so an agent on another
machine has nothing to dial yet. Give it an address:

```json
"listen": {"host": "0.0.0.0", "port": 8080}
```

The control page does not open with it — it still answers only the machine serviceman runs
on. The remote door is the one thing on that port a stranger may knock at, and the token is
what gets them in.

## A machine that takes the traffic

Beside the agent is `http.sock`, and whatever connects to it is answered by the agent itself.
A machine that owns a public address needs nothing on it but the agent: no serviceman, no port
open to one, and no tunnel of your own.

**The agent routes; serviceman only writes the table.** For each name its door answers, the
agent asks the wall in front of it, and only when the wall was reached and said yes carries the
request to the service — straight to it on this machine, or to the agent of the machine it runs
on, over the tailnet. serviceman writes each machine the table it routes by — its names, where
each service they need runs, how to reach the other machines' agents — and the machine keeps it
on its own disk (`doors/table.json`, beside the agent). serviceman is in none of the traffic:
with it down, the doors go on answering from the table they hold, and a machine that restarts
meanwhile serves what it served before.

What the table cannot route still goes to serviceman over the link, as every request did before
the doors routed themselves: a name the table does not have, a service serviceman answers
itself. Those stop when serviceman does.

**A service on this machine** is found the way it is now: a container by asking docker for the
port it has — and starting it first, if it is stopped, which is how a sleeping service wakes
with serviceman away — a program by its port, an address serviceman does not start by that
address. A container that does not exist yet is serviceman's to make. Requests through the door
count as the service being in use: serviceman does not stop as idle what a door is keeping busy.

**A service on another machine** is asked of that machine's agent: each agent listens for its
peers on its tailnet addresses, port `7303` (`--peer-port`, `SERVICEMAN_PEER_PORT`; `0` turns it
off), and answers only a caller holding the token serviceman gave it, and only for the services
that run on it. The **Doors** page says, for each machine, whether it routes by itself and holds
the latest table.

**There is no door until one is asked for.** `--http-socket-mode 0660` (or
`SERVICEMAN_HTTP_SOCKET_MODE` in the agent's `env`) is the whole of the asking: without it the
agent opens nothing, and a machine carries requests in only because somebody said it should.

The mode is also the whole of who may knock — `0660` and a group for that machine's web server,
`0600` for nobody but the user the agent runs as. The door stands for the life of the agent,
link or no link.

```nginx
upstream serviceman {
    server unix:/home/you/serviceman-agent/http.sock;
}

server {
    listen 443 ssl;
    server_name devservice.example.com;

    location / {
        proxy_pass http://serviceman;
        proxy_http_version 1.1;
        # the door routes by this name and nothing else
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 1h;
        # an event stream goes out as it comes, an upload as large as the service takes
        proxy_buffering off;
        client_max_body_size 0;
    }
}
```

**A door answers the names it was given, and none at all by default.** A rule is a name and
the service that takes it, written on the machine's own entry. A service's page lists its
public addresses and adds, switches and removes them; the **Doors** page has every machine's:

```json
{"name": "laptop", "token": "0c0f…a91b", "inbound": {"echo.example.com": "echo", "*.example.com": "site"}}
```

The name is not the service's own address: `echo` goes on publishing whatever it publishes,
and this is a name it also answers to, on that machine's front. Nothing has to be renamed to
be served from another machine.

A rule can be set aside without being taken away — the name keeps its place and stops
answering, which is what an afternoon of quiet wants rather than retyping it later:

```json
"inbound": {"echo.example.com": {"service": "echo", "off": true}}
```

### A wall in front of a name

`auth` names a service to ask before anything behind it is touched —
[authwall](https://github.com/vbarbarosh/authwall), or anything that answers the same door:

```json
"inbound": {
    "sam.example.com": {"service": "notes", "auth": "authwall"},
    "*.example.com":   {"service": "site",  "auth": "authwall"}
}
```

Nothing is proxied through the wall. The door asks it `GET /auth/sidecar` with the name that
was asked for, the whole address, the visitor's cookie and their address, and reads the answer:

| The wall says     | The door does                                                             |
|-------------------|---------------------------------------------------------------------------|
| `200`             | Answers with the service, carrying the wall's `X-Auth-User` to it.        |
| `401` or `403`    | Sends the visitor to `/auth/sign-in?return=…` on the name they asked for. |
| nothing, or else  | Answers 502 and touches nothing behind it: a wall that cannot be asked is a closed door. |

`/auth/…` on a walled name is the wall's own: its sign-in page, its callbacks. That is what
lets the sign-in happen on the visitor's own address rather than somewhere else.

**One wall stands in front of as many names as point at it.** It never learns where any of them
lead, so nothing about it changes when a rule does. The wall may run on any machine: the door
reaches it the way it reaches any service. serviceman writes nothing into its environment: the wall's own name (`AUTHWALL_PUBLIC_URL`), the cookie domain shared by the names
it guards (`AUTHWALL_COOKIE_DOMAIN`), and who may sign in (`AUTHWALL_ALLOWED_EMAILS`) are
yours, and are the whole of what it needs.

The service behind a wall is untouched — it keeps its own address, and answers there as it
always did. Whatever a visitor claims about themselves in `X-Auth-User` is dropped: what the
service reads is the wall's word.

### A port at home, on a public name

A port of a computer with no public address (the laptop, behind the home router) is served on
a name of the machine that has one. It is an `external` service on the laptop and a rule on the
machine, nothing more:

```json
"remotes": [
    {"name": "vps1", "token": "0c0f…a91b", "inbound": {"phone.example.com": "phone-door"}},
    {"name": "laptop", "token": "5e1d…07c2"}
],
"services": [
    {"name": "phone-door", "type": "external", "remote": "laptop", "publish": {"host": "phone-door.localhost"}, "upstream": "127.0.0.1:8771"}
]
```

The request comes in at vps1's front, its door hands it to the laptop's agent over the tailnet,
and that agent carries it to `127.0.0.1:8771`. Nothing at home opens to the internet, and the
port may stay bound to the loopback. The body is streamed both ways, so an upload and an
event stream that stays open for hours pass as they are; whatever the front sets (an upload
limit, a read timeout, buffering) still holds, and so does a CDN's (Cloudflare drops a stream
quiet for 100 seconds). Both are in the config, so they outlive a restart of either side.

**What a door carries is marked.** Every request it carries gets `X-Serviceman-Relay: 1`, set
over whatever the visitor sent, so a service that lets more in at home (a pairing, a first
sign-in) can refuse it to whoever came through a door. Who they are is in `X-Forwarded-For`, as
the front wrote it.

**When the laptop is away** (asleep, off, off the tailnet), the door waits 10 seconds for a
connection and answers `502`. A front or a CDN may answer for it with a 5xx of its own, so a
client reads any 502, 503, 504 or 52x as "not reachable now".

## A port or a socket from one machine to another

A forward makes a port of one machine show up on another, the way `ssh -L` does, with no ssh:
the machines' links to serviceman carry it. `from` is where the service is, `to` where it shows
up. A Loki on vps1's loopback, as a socket file on the laptop:

```json
"forwards": [
    {"label": "Loki on vps1", "from": {"remote": "vps1", "port": 3100}, "to": {"remote": "laptop", "socket": "~/repos/loki.sock"}}
]
```

The laptop's agent listens on `~/repos/loki.sock`. Each connection opens a stream over its link
to serviceman, serviceman opens one over vps1's link to `127.0.0.1:3100`, and joins the two. A
port works as well as a socket at either end, and a service at home brought to a server is the
same thing written the other way round.

- **The socket stays.** The agent keeps listening while its link is down: a connection then is
  closed at once, and the first one after the redial goes through. A dead ssh holds a socket
  for as long as its keep-alives take to notice; a forward has none to wait for.
- **Nobody else's.** A socket file is `0600`, for the agent's user alone; a port is bound to
  `127.0.0.1`. A machine may open only the forwards whose `to` is itself: one that names
  another machine's forward is refused, and nothing is dialled for it.
- **A socket someone else answers on is theirs.** An `ssh -L` already on that path keeps it; the
  page says the forward cannot listen, and it is tried again every minute. A file left by a
  process that is gone is taken over.
- **What it says.** The Doors page lists every forward: where it listens, whether a connection
  would go through now and if not why (`vps2 is offline`, `the agent on laptop is older than
  forwards — update it`), the connections open and in all, the bytes each way, and the last
  failure.

Both ends run the agent, so a host that runs none (a box you only ssh into) still needs ssh.
A forward carries bytes and nothing else: what is spoken over it is between the two programs.

### A forward onto serviceman itself

`to` may be serviceman itself instead of a machine: `"here": true` in place of `remote`.
serviceman then listens in place of an agent, and the machine with the service is the only one
that needs one. vps1's Loki, as a socket file beside serviceman:

```json
"forwards": [
    {"label": "Loki on vps1", "from": {"remote": "vps1", "port": 3100}, "to": {"here": true, "socket": "sockets/loki.sock"}}
]
```

- **Where the socket lands.** In serviceman's state dir (`SERVICEMAN_STATE_DIR`), written from
  it: `sockets/loki.sock` is `data/sockets/loki.sock`. A path from `/` or `~/`, or one that goes
  up with `..`, is refused. Its folder is made when it is missing. `bin/run` already mounts the
  host's `./data` at `/app/data`, the state dir in the image, so the socket is on the host's
  disk at `./data/sockets/loki.sock` with no extra docker mount.
- **Whose it is.** The socket is `0600`. A serviceman that runs as root, as it does in a rootful
  docker, gives it, and any folder it made for it, to whoever owns the state dir: on the host,
  the person who owns `./data` opens it, and nobody else. Any other serviceman keeps it for its
  own user.
- **A port** (`"port": 3100`) listens on serviceman's own `127.0.0.1`. Under `bin/run` that is
  the container's loopback, which the host does not reach; a socket is the way out of it.
- **The rest is a forward like any other.** A connection while vps1 is away is closed at once
  and the reason is kept; a file left by a serviceman that crashed is taken over, a file that is
  not a socket is never deleted, and a socket that cannot listen is tried again every minute and
  shown on the page. A forward set aside or taken out of the config closes, and its file goes.

## Through a reverse proxy

The agent asks for an HTTP upgrade on `/api/v1/remote`, the same shape as a websocket. nginx
and caddy carry it with their usual websocket block; give it a long read timeout, because the
link is quiet between requests.

```nginx
location /api/v1/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_read_timeout 1h;
}
```

A CDN in front will not hold a link open for hours. Point the agent at the origin.

## What the token buys

Whoever has the token can dial in as that remote. Then this host will run containers on that
machine, read their logs, make folders for their volumes, and reach any port on its loopback
through the tunnel. Treat it like an ssh key: one token per machine, 32 random bytes, kept in
a file only root can read.

The other direction is narrow, but not empty. The agent does what it is asked and nothing
else: docker commands, a folder for a bind mount, and streams — to a port on its own loopback,
or to its docker socket, which is how a shell in one of its containers is opened from here. A
forward's listener is the one way a connection on the machine reaches the host, and only under
a forward's label.
That socket is docker itself, so a remote trusts this host as much as this host trusts
whoever reaches its control page. Its firewall too: ufw's rules are written from the control
page, as root. The agent runs no shell of its own for the host, and it never dials anywhere
except the `--url` you gave it.

## Not built yet

- A compose stack cannot be run by an agent.
- Nothing is placed automatically: you name the remote, or the service does not run.
