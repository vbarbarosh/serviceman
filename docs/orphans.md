# Orphans

Not built. Written down while it was fresh, to be resolved later.

## The case

serviceman makes things on machines: containers, folders, processes, the volumes it was told to
create. Every one of them can outlive the service that asked for it — the service is edited out
of the config, its remote is offline on the day it is removed, a machine is added back a month
later with everything still on it. What is left behind is nobody's: serviceman made it, and
serviceman no longer knows about it.

Today only one of these is handled. A program that leaves the config is stopped, its uninstall
line runs, and the folder serviceman made for it is removed. Everything else stays:

| What is left                       | Why it is left                                              |
|------------------------------------|--------------------------------------------------------------|
| The container of a removed service | Containers outlive serviceman on purpose, and are adopted again |
| Anything on a machine that was offline when the service was removed | Nobody could be asked to remove it |
| A folder or container of a service that moved to another machine | The old machine was never told |
| A named volume                     | It holds data, and data is never removed by a config edit    |

## What serviceman would have to do

**Know its own work when it sees it.** Every mark is already there: containers carry
`serviceman.service=<name>`, folders carry `.serviceman-app`, running programs are the agent's
own children and it knows each by name and slot. A sweep of one machine can list what carries
a serviceman mark and match it against the config that machine is meant to run.

**Say so, and stop there.** An orphan is a finding, not an order: a page that lists what was
found, on which machine, and how old it is. Removing is one click per thing, and the click is a
person's. A config edit must never quietly delete a container or a folder — the more so for a
machine that was merely offline at the wrong moment.

**Ask every machine.** The agent already runs `docker` and knows its own home; the sweep is
one call per remote, and a machine that joins later is swept when it dials in.

## The decisions still open

- Does removing a docker service remove the container serviceman made and named? The same
  principle as a program's folder says yes. Containers being adoptable says no.
- Named volumes: never removed automatically. Listed as orphans, with the size, and a person
  decides.
- How old is old enough to be worth showing? A container stopped an hour ago may be a service
  somebody is about to add back.
- Where the sweep lives: a page of its own, or a line on the machine's page that opens it.
