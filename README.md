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

## Docs

Also as a site: https://vbarbarosh.github.io/serviceman/, built from these files by
`bin/build-pages`.

- [Overview](docs/overview.md) — what serviceman is, what it serves, what it is not
- [Philosophy](docs/philosophy.md) — nothing you could not do by hand, and the command on every part of the page
- [Use cases](docs/usecases.md) — the situations it is used in, as configs you can copy
- [Config](docs/config.md) — every field of serviceman.json, the three kinds of service, the policies
- [How it works](docs/how-it-works.md) — what happens between the knock and the page
- [The log](docs/logs.md) — one shape per line, and how to read a trace back to its cause
- [Remotes](docs/remotes.md) — carry services on another machine, with an agent that dials in
- [Deploy](docs/deploy.md) — DNS, port 80, TLS, systemd, who may reach the control page
- [Terminals from another program](docs/terminals.md) — list, join and type into a machine's kept terminals, from Visual Notes or a script

## Tutorials

- [A coding agent on a machine](docs/tutorials/coding-agent-on-a-machine.md) — Claude in ai-box
  on a VPS, a deploy key to push with, a terminal that outlives the page

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
