# serviceman

<img src="img/serviceman.svg" alt="serviceman" width="455">

serviceman answers on the hostnames you give it. When a request arrives for a service that is
asleep, serviceman starts it — a docker image or a program — waits until it answers, and
passes the request on. When nobody visits for a while, serviceman stops it again. You write
one config file; the hostnames do the rest.

A service runs on a machine with an agent: put the agent on a VPS, or on the machine beside
serviceman, name it in the config, and serviceman starts containers there and carries the
requests over the link the agent dialled. serviceman itself runs nothing but the doors.

## Philosophy

serviceman does nothing you could not do by hand. Each thing it does is a command you could
type on the machine yourself (`docker run`, `docker exec`, `ps`, `apt-get upgrade`), and it
leaves behind what that command would leave: a container, a file, a terminal you can join
with `socat` over ssh. The ordinary tools always show the same thing the
page shows. See [Philosophy](docs/philosophy.md).

## Start

    bin/configure
    bin/run

`bin/configure` installs the packages, builds the image and writes `data/serviceman.json`, a
starting config, when there is none; `bin/run` runs the image with it. Open
http://serviceman.localhost:3001 for the control page, and add a machine and a service there or
in the file ([Config](docs/config.md)); then visit the service's hostname.

**The modules on this computer only**, with no serviceman, image or agent to install:

    bin/run-local

It runs [module-host](src/module-host/README.md), with the agent's own code inside it, and prints
the address of its page: Processes, Disks, Packages, Docker, Files, Terminal, Firewall and
Volumes, of this computer, as the user who started it.

## Docs

Also as a site: https://vbarbarosh.github.io/serviceman/, built from these files and the
modules' by `bin/build-pages`.

- [Overview](docs/overview.md) — what serviceman is, what it serves, what it is not
- [Philosophy](docs/philosophy.md) — nothing you could not do by hand, and the command on every part of the page
- [Use cases](docs/usecases.md) — the situations it is used in, as configs you can copy
- [Config](docs/config.md) — every field of serviceman.json, the three kinds of service, the policies
- [How it works](docs/how-it-works.md) — what happens between the knock and the page
- [The log](docs/logs.md) — one shape per line, and how to read a trace back to its cause
- [Remotes](docs/remotes.md) — carry services on another machine, with an agent that dials in
- [Shared folders](docs/shared-folders.md) — one folder on every machine, at a path of each one's own, read-write or read-only, encrypted
- [Deploy](docs/deploy.md) — DNS, port 80, TLS, systemd, who may reach the control page
- [Terminals from another program](docs/terminals.md) — list, join and type into a machine's kept terminals, from Visual Notes or a script

## Tutorials

- [A coding agent on a machine](docs/tutorials/coding-agent-on-a-machine.md) — Claude in ai-box
  on a VPS, a deploy key to push with, a terminal that outlives the page

## Modules

Parts of the control page that stand on their own: a page half and a server half, and a host
that gives them what they reach. serviceman is the first host of each.

Each module holds items of a few kinds and does commands on them, and says which in its
manifest, `server/<name>_manifest.js`. Every module's API has the same shape, under the base
the host mounts it at; the kind is left out for the module's own:

    GET  <base>/<kind>                  the items
    POST <base>/<kind>                  one made
    POST <base>/<kind>/<command>        a command on all of them (prune, upgrade)
    GET  <base>/<kind>/<command>        how a long one goes, for one that is kept (upgrade)
    POST <base>/<kind>/<id>/<command>   a command on one (start, stop, remove)

A long command answers a stream rather than waiting for its end: `{stream, url}`, and the
stream is read at `GET /api/v1/streams/<id>`, one JSON object a line, from its first line,
then as it goes, to its end. serviceman keeps it, so the command goes on when the page that
asked closes, and a page that reloads reads it again from the start; `GET /api/v1/streams`
lists the ones kept, ten minutes past their end. Docker's pull, update, recreate and prune and
the package upgrade answer one. Joining a terminal is one that goes both ways: the WebSocket
opens at its address, once, within a minute.

A kind of items also says how a page shows them: `key`, the field or fields that name one;
`columns`, each `{key, label, as, fold, sort}`, `as` one of `text`, `code`, `bytes`, `count`,
`duration`, `ago`, `percent` (with `full`, where its bar is full), `share` (`of` the field it is
a share of) and `flag` (`yes`, `no`), `fold` the order columns fold in on a narrow screen, the
lowest first, `none` what an empty cell says; `search`, the fields a filter looks in; `tree`,
`{id, parent}`, the fields that put each item under another; `group`, the field items stand
together by, each group a branch of the tree with its items under it; `sort`, the order it
starts in. The page's `items_view.js` draws every module's
lists from them, the same way everywhere: the filter, Read again and the commands to copy, a
header that sorts, a tree that folds. A module draws a cell itself only where it says more than
its `as`, and reads its items itself where its commands change them under the hand.

What is neither an item nor a command, a file read or written, a folder watched, another
module's API inside this one, the manifest names as a door. serviceman answers 404 for
whatever a manifest does not name, before the module is asked; gives a token only the rights a
manifest names, door by door; and answers every manifest, with where it is mounted, at
`GET /api/v1/modules`.

- [Disks](modules/disks/README.md) — the disks of a machine: the room and the inodes of every
  filesystem it has mounted
- [Docker](modules/docker/README.md) — the containers of one machine, its compose projects,
  images, volumes and networks
- [Files](modules/file_manager/README.md) — a file manager: folders, uploads in parts, a whole
  tree as JSON or events, a folder watched, copies between disks
- [Firewall](modules/firewall/README.md) — what a machine listens on and what ufw lets through
- [Packages](modules/packages/README.md) — the packages of a machine: installed by hand or as a
  need, held, and what an upgrade would bring
- [Processes](modules/processes/README.md) — everything running on a machine, as a tree that
  folds, filters and sorts by CPU or memory
- [Terminal](modules/terminal/README.md) — xterm on a page, joined over a websocket to a shell
  in a container or a pty on a machine
- [Volumes](modules/volumes/README.md) — encrypted volumes of a machine: LUKS in a file, opened
  at a folder, the key never kept on the machine

## Code

Every file here, Logline's included, follows the rulebook at
[vbarbarosh/rules](https://github.com/vbarbarosh/rules) — the rules one per line in
[docs/rules.md](https://github.com/vbarbarosh/rules/blob/main/docs/rules.md), formatting in
[FORMATTING.md](https://github.com/vbarbarosh/rules/blob/main/FORMATTING.md). Its lint checks
them:

    npm run lint

The agent has a version of its own, in `src/agent/version.json`, and every change to it raises
that version: `bin/agent-version patch` for a fix, `bin/agent-version minor` for something new.
A major version is the author's alone. `tests/agent_version.test.js` fails while the agent has
changed since its version was given, and says which command to run.

`serviceman.css` is plain css served as it is, with no preprocessor for `@include
app-transition`, so its transitions are written out by hand.

## License

[MIT](LICENSE)
