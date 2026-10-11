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
| Upgrade packages                   | `apt-get upgrade`                                        |
| Download a folder                  | `tar -cf -`                                              |

So what it makes is what the command would make: a container that `docker ps` lists, a
terminal you can join over ssh with `socat`. Nothing is kept in a form only
serviceman can read, and nothing it does needs serviceman to be undone. A feature that would
break this does not belong in serviceman.

## The page shows the command

What follows from it: a part of the page that shows something from a machine, or does
something to it, carries the command that does the same by hand, one click from the
clipboard. Processes copies its `ps`, a terminal the `socat` that joins it, Start its `docker start`.
The command is the one the agent actually ran, not one written again for the page, so it
cannot drift from what the page did. Paste it in a shell on the machine and you see the same
thing, or do the same thing, without serviceman.
