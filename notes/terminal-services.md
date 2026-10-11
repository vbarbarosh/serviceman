# Terminal services

Status: specification, nothing of it built. Written 2026-10-04 from the voice comment
20261004_120223 in the serviceman note, after a day of trying terminals out (web-terminal,
the agent restart fix, websockets through the link); the open questions answered in the voice
comment 20261004_121631 the same day.

## What is asked

From the voice comment, in English:

> Let's discuss creating terminal services. A web interface is just one of the applications of
> such a service. There must be a way to connect to a terminal: the web interface uses the
> terminal module now, but any application should be able to use an API to create and work with
> a terminal. We need to decide what the API looks like and how it works.

> Does it make sense to create a new type, terminal, or can it be done another way? On the remote
> server I configure a command, it is run, and what it does is handed over as a terminal.

> On the remote server I need docker; I run it through podman, so podman has to be set up there,
> and that should be possible through serviceman too. Serviceman is the way to manage these
> resources, the VPSes, remotely; with the agent installed I already have a terminal, so all of
> it should be done through serviceman, without logging in to the VPS by ssh. The command will
> be to start `ai`.

> The ai-box image has to be built again and again, because the programs inside it, Claude and
> Codex, update all the time. So how the image is built, with what command, and how often, has
> to be described. Through the API it must be possible to learn that there is a new version of
> the environment, so that a client can stop its inner processes properly and restart its
> terminals.

> Policies for a terminal's lifetime: it survives a dropped connection, but it does not hang
> there forever. Resource limits, so that one such service does not kill the whole server. And
> low priority: a VPS already runs something but is often idle; while it is idle something can
> run at low priority, so that nothing else suffers.

> First, a specification of all this, an md file, and then work from it.

The answers to the first draft's open questions (20261004_121631):

> Properly, all the folders and files should be in one place, with the application that loads
> them; but it is not clear yet how to organise it. There will be a copy over there, and the files
> will have to come back to the application that starts all these terminals. The correspondence
> with the agents is immutable: a message, once created, is created. Only some kinds change: the
> ones that show progress, plans. Maybe two folders, immutable and volatile; or just one folder.
> But the agent over there should have a local copy of the correspondence, and the application
> the main copy, the original of all these files.

> Which user: the ordinary one ai-box runs as. No root; ai-box is made so that I run it as an
> ordinary user, and inside there is no root, but it can run dockers.

> ai-box logins: as I see it, a process starts, ai-box, and you carry its terminal. What login?

> No public address. None of our services have one now; they work only over Tailscale, and are
> routed out if somebody really needs it.

> I don't know how to do it right, but I have already run into this: code works for a long time
> and prints only local updates, and when I open the terminal later I see a piece of text that
> looks like garbage; it turned out the terminal just needs a command to redraw itself fully.
> That has to be provided for too.

And on logins (20261004_122103):

> The simplest is a volume where the coding agent keeps its settings: ai-box mounts folders that
> outlive its `--rm`, and I tell agents that whatever must outlive a session goes only there. So
> on each machine I do the setup and the login once. But if ai-box agents can run on different
> machines, that folder has to be copied from the machine where it is set up to a new one, or the
> agent there will not start. How to deal with that?

> About refreshing at the same time: I logged in to Codex once, and run ten and more Codexes in
> parallel from that folder; there has never been a problem. Why can't it work the same across
> machines? (20261004_122406)

> Codex logs in without an access token: Claude Code and Codex run on subscriptions, with no tokens.
> (20261004_122454)

> That can happen if the folder is copied to another machine: a refresh, and these tokens stop
> working. At worst, one file can be synced: the agent watches it, and when it changes on a
> machine, carries it to the other machines. Note it as a mechanism, try it; I don't know how good
> it is. The other way is a login on each machine; then there must be a convenient UI, really
> convenient, to log in on the machines needed very fast. And a re-login will be needed about once
> a month. (20261004_122725)

> If there is a reliable mechanism to sync that auth.json, it can be used; but it must be
> reliable, not a crutch. (20261004_122743)

> We need to check it; we don't live in an ideal world. I open Claude ten times on one folder and
> it works fine, though it might not have. So it has to be checked. (20261004_124110)

> Let's go this way for now: serviceman will sync such a file somehow. If it does not work, we
> will do something else. For now let's pretend it all works. (20261004_124425)

> So as not to guess, to be more predictable: serviceman can watch some files, and when a file
> changes on one machine, spread it to the others; and keep all the versions of such files
> somewhere, just in case, to be on the safe side. I configure which files are synced between
> the agents and the machines; serviceman keeps all these files, and when one is updated, it
> carries it to the others. (20261004_133619)

## Where we are

- **web-terminal** (`web-terminal/`) is an ordinary HTTP service: a docker image (Ubuntu, node,
  tmux, tini) whose page is the Terminal module. `/<name>` is a kept tmux session inside that
  container, `/` a shell that ends with its page. It proved the pieces, but its shells are inside
  a container, so ai-box, which needs the machine's own podman, cannot run there.
- **The Terminal module** (`modules/terminal`) speaks one protocol over a websocket: binary bytes
  out, `{type: 'input', data}` and `{type: 'resize', cols, rows}` in, `{type: 'note', text, ok}`
  first. The control page's Shell tabs and web-terminal both use it. An open terminal guards its
  page against Ctrl-W, and offers Full screen with Keyboard Lock.
- **The machine Shell** (`/api/v1/shell?remote=`) is a login shell through the agent, under a
  python pty. It dies with its pane.
- **The agent survives its own restart**: its units have `KillMode=process`, and `type: shell`
  programs write to files and are written down on disk (`programs/<name>.<slot>.json`, pid and
  start time), taken back by the next agent, kept across a dropped link.
- **Websockets reach services on other machines** through the link, as requests do.
- Machines report `mem_free`, `cpu_busy`, `load`, `disk_free` and the core count every 30 s.
  Placement takes the first online machine of `remotes` and never looks at load.
- The root half runs `apt upgrade`, nothing narrower; installing a named package is not there.
- There is no clock for jobs: nothing runs on a schedule.
- **A folder on a machine is watched** (`…/fs/watch?path=&tree=1&skip=`): one inotify watch per
  folder on the agent, shared by everyone listening, server-sent events through serviceman.

## The decision: a terminal is not a service

A service is answered by hostname: anonymous requests, any copy may answer, copies come and go
with the load, and a copy sleeps when nobody asks. A terminal is the other way round: it is
asked for **by name**, it is **one** process that keeps its state (the program, the screen, the
scrollback), it goes on **with nobody attached**, and its end is its command's end or a policy's.
Bending services to that would break both: the idle stop, the pool, and the address are all wrong
for it.

So serviceman gets a second kind beside services, with three parts:

| Part | What it is | Like |
|---|---|---|
| **environment** | how a machine is made ready, and how its image is built, rebuilt and versioned (ai-box) | a docker image a service names |
| **terminal profile** | what a terminal runs and under which rules: command, environment, machines, lifetime, limits, priority | a service definition |
| **session** | one running terminal of a profile, with a name, on one machine | an instance |

What it shares with services: machines, tags and placement, the agent link and its tunnel, the
control door, Logline, the agent's disk records and their adoption after a restart.

web-terminal stays what it is, a playground and an example. The page that opens sessions of this
kind is a client of the API below, like Visual Notes will be.

## On the machine

The agent keeps the sessions. Each one runs under a **holder** that outlives the agent, the
pane and the link:

- The holder is tmux on a server of the agent's own (`tmux -L serviceman`), started outside the
  agent's process group and, where systemd is, in a scope of its own (`systemd-run --user
  --scope`), so its limits are its own cgroup's. The holder stays replaceable behind the agent's
  calls.
- **Every attach starts from the whole screen.** A program like a coding agent draws once and
  then sends only small updates: cursor moves and the few cells that changed. A terminal that
  joins that stream halfway gets the updates without the screen they apply to, and shows
  fragments that look like garbage. So an attach never replays the stream: the holder draws the
  current screen first, and only then passes the updates on. tmux does exactly this on attach.
  The client can also ask for it at any time (`{type: 'redraw'}`, below), and a resize redraws
  too. With several attaches of different sizes, the window follows the latest one (`window-size
  latest`), so the one being typed in is never cut to the smallest.
- A session is written down like a program: `sessions/<id>.json` beside the agent, with the
  profile, the machine user, the tmux session, the pid and start time, the environment version it
  started on, and when it was last attached. The next agent takes it back.
- An attach is a tmux client under the agent's pty, carried over the link like the machine Shell
  is today. Any number of attaches at once see the same screen.
- **It runs as the ordinary user the agent runs as**, the one ai-box is made for: no root, and
  ai-box gives it docker inside the box. The root half is used only for an environment's setup.
- **The box's state is per machine today.** ai-box mounts `data/claude`, `data/claude.json`,
  `data/codex` and `data/codex.json` from its clone into every box; they outlive its `--rm`. They
  hold the logins, and also each coding agent's memory, history and settings. A session placed on
  a machine where nobody has logged in starts logged out, and one placed on another machine than
  yesterday's starts without what was learned yesterday. See **The box's state across machines**.
- The agent reports its sessions with its stats (state, attached count, last output, last attach),
  so serviceman knows them after its own restart and can apply the lifetime rules.

## The API

On the control door, as the rest of `/api/v1`. The same shapes serve the control page, the
web-terminal page and Visual Notes.

Profiles are config, like services: `terminals` in serviceman.json, edited through
`/api/v1/config` and the control page.

```
GET    /api/v1/terminal-profiles                     the profiles, with each one's environment and its version
GET    /api/v1/sessions                              every session: id, name, profile, machine, state, attached, since, version, stale
POST   /api/v1/sessions                              {profile, name?, cwd?, env?, machine?} → the session (placed, started, not attached)
GET    /api/v1/sessions/<id>                         one session
WS     /api/v1/sessions/<id>/attach                  the Terminal module's protocol, plus {type: 'redraw'}; the session must exist
POST   /api/v1/sessions/<id>/restart                 end it and start it again: same name, cwd and env, newest version
DELETE /api/v1/sessions/<id>                         end it: SIGHUP to its process group, then the profile's grace, then SIGKILL
GET    /api/v1/environments                          each environment: version, built_at, machines that have it, a build running
POST   /api/v1/environments/<name>/build             build it now, on every machine that carries it
GET    /api/v1/events                                server-sent events: session_started, session_ended (why), environment_built (name, version), session_stale (id)
```

- **A name is the client's handle.** `POST` with a name that already has a live session answers
  that session instead of a second one, so "open the terminal of note X" is one call whatever
  state it is in. Without a name, serviceman makes one.
- **State** is `starting`, `running`, `lost` (its machine's link is down; it is most likely still
  running there), `ended` (kept in the list for a while, with why and its last lines).
- **Who may call**: the control door's rules, as today (the Tailscale network, the control
  socket). **No public address**: like every service here, terminals are reached over Tailscale
  only. Routing one out is the same decision as for any service, made one at a time, and not part
  of this.

## Environments

ai-box is the first environment. An environment says how a machine becomes ready, how the image
is built, how its version is read, and how often it is rebuilt:

```json
"environments": [
    {
        "name": "ai-box",
        "tag": "ai-box",
        "setup": [
            {"as": "user", "run": "git clone https://github.com/vbarbarosh/ai-box ~/ai-box"},
            {"as": "root", "run": "apt-get install -y tmux && ~/ai-box/bin/configure"},
            {"as": "user", "run": "cd ~/ai-box && bin/build"}
        ],
        "build": "cd ~/ai-box && git pull && bin/build",
        "version": "podman image inspect ai-box --format '{{.Id}}'",
        "rebuild": "daily 05:00"
    }
]
```

- **Setup through serviceman, never ssh.** The steps run in order. A `user` step runs through the
  agent; a `root` step through the root half, a new and narrow call: it runs an environment's root
  steps and nothing else, with `~` and `SUDO_USER` meaning the agent's user, so ai-box's own
  `bin/configure` installs podman and its packages and grants that user the subuids. Each step is a
  job whose lines go to the log as they print, like `apt upgrade` today. A machine that finished
  setup claims the environment's tag, so profiles that ask for `#ai-box` can be placed there.
- **Build** runs on every machine with the tag; one at a time per machine. Its output is a job's.
- **Version** is whatever the line prints: an image id here. It is read after every build and on
  the agent's start, and reported with the machine's stats.
- **Rebuild** is the first clock serviceman has: `daily HH:MM` or `weekly <day> HH:MM`, in a
  `time_zone` the config gains (Europe/Chisinau when it names none). A missed time (machine off)
  runs when the machine is back.
- **A new version** marks every session that started on an older one `stale`, and says
  `environment_built` and `session_stale` on `/api/v1/events`. The session is not touched: the
  client knows when its program can stop cleanly (a coding agent between turns), and asks for
  `restart` then. A profile may also say `on_new_version: restart_when_detached`, for sessions
  nobody is watching.

## Profiles

```json
"terminals": [
    {
        "name": "claude",
        "environment": "ai-box",
        "remotes": ["#ai-box"],
        "command": "~/ai-box/bin/run claude",
        "cwd": "~/work/{project}",
        "lifetime": {"detached_for": "24h", "quiet_for": "6h", "max_age": "7d", "on_exit": "end", "grace": "10s"},
        "limits": {"memory": "6G", "cpus": 2, "pids": 4096},
        "priority": "normal",
        "per_machine": 4
    }
]
```

### Lifetime

A session outlives a dropped connection by design; these say when it stops being worth keeping:

| Rule | Ends the session when |
|---|---|
| `detached_for` | nobody has been attached this long |
| `quiet_for` | nobody attached **and** nothing printed for this long (a coding agent working alone prints) |
| `max_age` | it has run this long, attached or not |
| `on_exit` | its command exits: `end` (default) or `restart` |
| `grace` | between SIGHUP and SIGKILL when it is ended |

Each rule is optional; `false` turns one off. An end by a rule is said on the log and the events,
with the rule, so "where did my terminal go" has an answer.

### Limits

Per session, applied to its scope where systemd is (`MemoryMax`, `CPUQuota`, `TasksMax`), and
passed to ai-box as `AI_BOX_MEMORY`, `AI_BOX_CPUS`, `AI_BOX_PIDS`, which `bin/run` already
reads. A session that hits its memory is OOM-killed alone; the machine and its services are not.

Per machine: `per_machine` caps the sessions of a profile on one machine. Placement also keeps
the memory the limits promise: a machine whose `mem_free`, less what its sessions are promised,
is below a new session's `memory` is not chosen.

### Priority

`priority: low` is for sessions that may use a machine only while it is idle:

- **Placed only on an idle machine**: `cpu_busy` below 30% and `load` per core below 0.5 for the
  last 10 minutes, and the memory free as above. Thresholds per machine, with these defaults.
- **Yields while it runs**: its scope runs with `CPUWeight=idle` (it gets CPU only when nothing
  else wants it) and `IOWeight=10`, and `OOMScoreAdjust=500`, so under memory pressure the kernel
  takes it before the machine's own services.
- **What happens when the machine gets busy** is the profile's `on_busy`: `nothing` (the weights
  already yield; the default), `freeze` (the scope is frozen through the cgroup freezer and thawed
  when the machine is idle again; network timeouts inside may suffer), or `end`.

## Placement

The first rule beyond "first online": among the machines of `remotes` that are online, have the
environment at its newest version, are under `per_machine`, and have the memory, take the one with
the most memory free after promises, then the lowest load per core. A session stays on its machine
for its life; a restart may land elsewhere only if its own machine no longer fits.

## The files of a session

The application that starts the terminals keeps the original of every file; the machine keeps a
copy to work in, and what is made there comes back. For Visual Notes that is the note folder:

- **The original is the application's**; the session's folder on the machine is a copy, made
  before the session starts and kept in step while it runs.
- **Most files never change once written**: a message (`messages/*-me.md`, `*-agent.md`) and a
  file (`files/*`) are created once. They are copied once, by name, in whichever direction they
  were made, and never compared again. A name that turns up on both sides with different content
  is a conflict: both are kept, the second under a new name, and it is said.
- **A few files change**: a plan (`roadmaps/*-plan.md`), whose parts are ticked as the work goes,
  and a `.working` marker, which comes and goes. They follow the newest write, both ways; a marker
  removed on one side is removed on the other.
- One folder is enough: which files change is known from their names, so no `immutable/` and
  `volatile/` split is needed. A note folder already has the shape.
- **Who copies**: the application, through serviceman's file calls on the machine
  (`/api/v1/remotes/<name>/fs/...`, there today), so serviceman needs to know nothing of notes.
  Changes on the machine are heard without polling through the watch,
  `GET /api/v1/remotes/<name>/fs/watch?path=` (server-sent events of created, changed, removed,
  resync; built 2026-10-08, `modules/file_manager/README.md` says how).
- The project a coding agent works on (the code itself) is the same question for a git
  checkout, and it is still open: a clone per session on the machine, and its commits coming back
  how, while ai-box keeps `.git` read-only inside the box?

## The box's state across machines

Two different things live in ai-box's `data/`, and they travel differently.

**The login: copied, and kept as one file.** Ten Codexes on one machine share one login without
trouble because they share one *file*: when one of them renews the login, it writes the new tokens
there, and the others read them from there. Copies on two machines are two files. If a renewal
retires the tokens it replaces (whether Claude's and Codex's logins do is not checked here), the
machine that did not renew is left holding retired ones, and is logged out at its next renewal.

**Chosen: the login files are synced files** (20261004_124425, 20261004_133619): a general
feature of serviceman, below, of which the two login files are the first use. At setup the login
folder is copied from a machine where it works; from then on its login files are kept in step,
and one re-login on any machine reaches every machine.

**Its weak spot, known**: if a renewal retires the tokens it replaces, two machines renewing
within the same seconds lose one login, and a running agent that keeps its tokens in memory may
write old ones back over a newer file. The test below says whether that can happen at all. If it
does happen, the way out is ready:

- **A login per machine**, made fast by the page below: each machine a device of its own on the
  subscription, nothing shared.
- **For Claude, a login with nothing to renew**: `claude setup-token` ("requires Claude
  subscription"), given to every box as `CLAUDE_CODE_OAUTH_TOKEN`; ai-box would have to pass that
  variable into the box (`bin/run` passes none today). Codex has no such subscription login known
  here (`--with-api-key` is API billing; `--with-access-token` is not checked).
- **The test**: two copies of a login folder on one machine look to the server like two machines.
  Copy A is made to renew, then copy B renews with the tokens it was copied with; if B is refused,
  renewals retire tokens. The script is in the serviceman note,
  `files/20261004_124216-agent-try-login-copy.sh` (`claude` or `codex`). It only touches copies,
  but a renewal that retires tokens retires the original's too, so a run may cost one login again.

**A logins page**, needed either way, because a re-login comes about once a month:

- One table: machines down, coding agents across (Claude, Codex), each cell the state: logged in,
  logged out, or not set up.
- **Log in** in a cell opens a terminal on that machine with the agent's own login in it: the
  login command inside the box for Claude (it shows a link and asks for the code), `codex login
  --device-auth` for Codex (it shows a code to type on the laptop). One click to a terminal where
  only the code is left to type. **Log in everywhere** walks a column, machine after machine.
- serviceman says on the page, and on the events stream, when a machine is logged out, so a
  session is not placed there to fail.

Both logins are the subscriptions'; no API key is used, and none is wanted.

**What the agents learn: a folder, kept like a note.** Memory, settings and instructions
(`data/claude/projects/*/memory`, `CLAUDE.md`, `settings.json`, Codex's `AGENTS.md` and config)
are what makes an agent the same agent on any machine. They follow the rule of the note folder:
the original is kept in one place, each machine works on a copy, made before the session starts
and brought back as it changes. Where the original lives is the open part: with serviceman (it
already keeps secrets and volumes), or with the application that starts the sessions.

History and caches (`data/claude/projects/*/*.jsonl`, `data/codex/sessions`) stay per machine:
large, and not needed to start. A session that must continue a conversation (`claude --continue`)
is placed back on its own machine.


## Synced files

A file that should be the same on several machines is named in the config, and serviceman keeps
it so, with every version it ever had:

```json
"synced": [
    {"name": "claude-login", "path": "~/ai-box/data/claude/.credentials.json", "remotes": ["#ai-box"], "mode": "0600"},
    {"name": "codex-login", "path": "~/ai-box/data/codex/auth.json", "remotes": ["#ai-box"], "mode": "0600"}
]
```

- **Watched on every machine** of `remotes` by its agent (a file watch, and a look every minute
  besides, for the changes a watch misses). A change is the file's content becoming different; the
  agent sends the whole file, with when it changed and a hash.
- **Every version is kept** by serviceman, in its state folder beside the secrets and with the same
  care (`synced/<name>/<time>-<machine>-<hash>`, owner-only). Nothing is thrown away by the sync
  itself; `keep` (default 100) bounds the history of one file.
- **The newest is the current one.** A version newer than the current becomes current and is sent
  to every other machine of `remotes`; a machine that is offline gets it when it dials in. An older
  version arriving after a newer one is kept in the history and not sent anywhere.
- **Written whole on arrival**: the agent writes a new file beside the old one and renames it over,
  so nothing ever reads half of it, and does not report its own write back as a change.
- **Two changes close together** (on two machines, within a minute) are both in the history; the
  newer one wins, and the log and the events stream say there were two, so a lost login has an
  explanation and its predecessor is there to restore.
- **A machine that joins later** gets the current version when it is set up, or when it first
  dials in with the tag.
- **The API**: `GET /api/v1/synced` (each file: current version, where from, when, which machines
  have it), `GET /api/v1/synced/<name>/versions`, `GET /api/v1/synced/<name>/versions/<id>`, and
  `POST /api/v1/synced/<name>/versions/<id>/restore`, which makes an old version current and sends
  it everywhere. The control page shows the same as a kind on the rail.

Folders are not synced this way: a folder is many files changing together, which is the note
folder's way (above), not this.

## Security, left as a note

Raised 2026-10-08 (voice 170644), not decided. The terminal and file calls give whoever holds
them the whole machine as the agent's user: every folder of its home, `~/.ssh` included, and any
command. The author's view: they are held by the application that starts the terminals, never by
the agent in ai-box, so it is as safe as the application running on the local machine.

- What holds it today: the control door answers the serviceman host only (`127.0.0.1`, the
  `0600` socket, or a proxy with `exposed`). A box on a remote machine cannot reach it; the
  agent there only dials out, and answers the host alone.
- The file calls add nothing a terminal does not already give: the same user, the same files.
- To look at when it comes back: a box on the serviceman host itself, whose mounted project folder
  holds the control socket (the dev setup: `/app/data/serviceman.sock`, mode `0666`); and paths
  limited to a root per application, instead of the whole home.
- Raised again (voice 175623): terminals are global, and whoever reaches serviceman reaches every
  machine. True by design today (deploy.md: the control page has no password; remotes.md: a
  remote trusts the host as much as the host trusts its control page). Ways to narrow it, each a
  bigger step:
  1. A token per client on the control door: terminals and files only, on listed machines, its
     own terminals only (an owner on each).
  2. A Unix user per client on the machine: its terminals and files as that user, not the
     agent's. Also closes the ssh-agent gap: another user cannot open the socket.
  3. A wall the machine keeps: what it allows, the host cannot widen. Holds only if the machine
     also refuses agent updates and root halves it did not approve, since the host sends both.

## Decided

1. **Files**: the application keeps the originals; the machine a working copy; immutable files are
   copied once by name, plans and markers follow the newest write; one folder (above).
2. **User**: the ordinary user the agent runs as, which is ai-box's. No root.
3. **Logins**: subscription logins, no API keys. The login files are synced files: watched on
   every machine, every version kept by serviceman, the newest sent everywhere, any version
   restorable. A logins page for re-logins. If machines get logged out anyway: a login per
   machine, or Claude's `setup-token`.
4. **Address**: none public; Tailscale only.
5. **Holder**: tmux, because the whole screen on every attach is what matters, and tmux does it.
   A holder of our own would only add the scrollback to the API, which nobody needs yet.

## Order of work

- Sessions on a machine: the holder, the disk records, adoption, attach over the link with the
  whole screen first, redraw, end
- The sessions API: create by name, list, attach, end, restart; the events stream
- Terminal profiles in the config, and placement by memory and load
- Lifetime rules, enforced from the agent's reports
- Limits through scopes and ai-box's own variables
- Environments: setup jobs through the root half, build, version, the clock for rebuilds, stale
- Low priority: idle placement, weights, on_busy
- A watch on the machine's files, for the application's copy of a note folder (built 2026-10-08)
- Synced files: named in the config, watched by the agents, every version kept, the newest sent
  everywhere, restore; the two login files as the first
- The logins page: machines by agents, state, one click to a terminal with the login
- The agents' memory and settings kept in one place and copied to the machine a session runs on
- The control page: a Sessions kind on the rail, opening a session in the Terminal module
- web-terminal as a client of the API instead of tmux in its own container
