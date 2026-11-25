# Philosophy

## Nothing you could not do by hand

serviceman does nothing you could not do by hand. Each thing it does, on the page or on its
own, is a command you could type on the machine yourself; it only types it for you, at the
right moment.

| serviceman                         | By hand, on the machine                                  |
|------------------------------------|----------------------------------------------------------|
| Starts and stops a docker service  | `docker run`, `docker stop`, through docker's own socket |
| Shell in a container               | `docker exec -it <container> sh`                         |
| A terminal kept on a machine       | `socat -,raw,echo=0 UNIX-CONNECT:<agent>/terminals/<name>.sock` joins it |
| Processes, Ports, Disks, Packages  | `ps`, `ss`, `df`, `dpkg-query`                           |
| Upgrade packages                   | `apt-get full-upgrade`, `snap refresh`                   |
| Download a folder                  | `tar -cf -`                                              |

So what it makes is what the command would make: a container that `docker ps` lists, a
terminal you can join over ssh with `socat`. Nothing is kept in a form only
serviceman can read, and nothing it does needs serviceman to be undone. A feature that would
break this does not belong in serviceman.

## serviceman sets the machines up; they carry the traffic

serviceman's part is to set the agents up: which one listens where, what each may reach, which
address it dials and on what port. The traffic itself goes from machine to machine over the
network they share, the tailnet, and not through serviceman. Two agents set up by hand would do
the same; serviceman writes it down and tells them, and what it set up goes on working while it
is away.

Where that stands now: the doors of a machine route by themselves
([A machine that takes the traffic](remotes.md#a-machine-that-takes-the-traffic)), a forward
whose two ends are one machine is joined by its agent
([Both ends on one machine](remotes.md#both-ends-on-one-machine)), a forward and a mount between
two machines go straight from agent to agent
([A port or a socket from one machine to another](remotes.md#a-port-or-a-socket-from-one-machine-to-another),
[Mounts](mounts.md#how-it-works)), and an app board is answered by the agent of each machine it
is on, straight to its apps ([App boards](config.md#app-boards)). Still through serviceman: a
forward or a mount whose agents cannot reach each other, and a request to serviceman's own door
for a service on another machine.

## The page shows the command

What follows from it: a part of the page that shows something from a machine, or does
something to it, carries the command that does the same by hand, one click from the
clipboard. Processes copies its `ps`, a terminal the `socat` that joins it, Start its `docker start`.
The command is the one the agent actually ran, not one written again for the page, so it
cannot drift from what the page did. Paste it in a shell on the machine and you see the same
thing, or do the same thing, without serviceman.
