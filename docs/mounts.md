# Mounts

A mount is a folder of one machine, seen on another: `~/Pictures` of the laptop at
`/mnt/photos` on vps1, read-only, or serviceman's own `data/` at `/mnt/serviceman`. The machine
it is mounted on reads it, and writes it too when the mount is read-write, as any folder of its
own; the files stay where they are.

The page is **Mounts** in the rail, under Shared folders. **+ Mount…** picks the machine the
folder is on and the folder, the machine it is mounted on and where, and the mode: read-only or
read-write. Each mount is a row: where it stands, what is wrong with it, what went through it.
A row's actions (a click on a row opens them where the table has no room) set it aside and back
without retyping it, **edit** it, or **forget it**, which takes it out of the config and
unmounts it.

## How it works

No ssh and no key: the machines' agents are already there, and a mount goes from one to the
other as a forward does ([Remotes](remotes.md#a-port-or-a-socket-from-one-machine-to-another)).

1. serviceman tells the machine at `to` its mounts, at its hello, after the config changes and on
   the minute.
2. Its agent listens on a socket file of its own for each one, `0600`, in its folder's
   `mounts/`, and hands the table to its root half.
3. The root half mounts each with sshfs. In place of ssh, sshfs runs the agent's own file,
   `--pipe <the socket>`, which joins sshfs to that socket.
4. The agent takes what comes in on the socket straight to the agent of the machine at `from`,
   over the tailnet, on its peer port, asked with the token serviceman gave that machine; that
   agent serves the folder over SFTP. serviceman tells the one where the other listens, and the
   other which mounts it may be asked for, and carries none of the bytes.
5. Through serviceman when it has to: a folder of serviceman's own state dir, an agent from before
   the straight way at either end, or a peer that does not answer within 3 seconds (asked again 30
   seconds later). The agent then carries it over its link, as a stream named for the mount, and
   serviceman joins it to the folder: a stream over the link of the machine at `from`, or its own
   server for its state dir. The row says which way it goes, and why when it is not straight.

When a link blinks, sshfs dials its pipe again by itself (`reconnect`). A restart of either
agent leaves the mount where it is: sshfs runs on its own, and the socket is there again at the
agent's next hello.

## What the far machine sees

The folder, and nothing else. `/` over there is the folder here, and `..` stops at it. A link
inside the folder that leads out of it is not followed: not by a path that goes through it, not
by an open file, which is checked again once it is open. A link is never made over a mount:
one made here could lead a program of this machine out of the folder. Neither is an owner
changed. What it is told when something fails is the kind of failure, never a path of this
machine.

A read-only mount is read-only twice: the folder's server refuses every change, and sshfs mounts
it with `ro`. root on the machine it is mounted on reads every file the mount shows, as it reads
its own disk: a folder with keys in it, serviceman's `data/` above all, gives them to that
machine's root. Mount the part that is needed (`logs`, not `.`) when that is enough.

## What a row says

| State          | What it means                                                                  |
|----------------|--------------------------------------------------------------------------------|
| mounted        | It is there, as the row says                                                   |
| starting       | Told to the machine, not answered yet                                          |
| set aside      | Written down, not mounted                                                      |
| `vps1` offline | The machine it is mounted on is away; it is mounted once its agent dials in    |
| agent too old  | An agent at either end is older than mounts; update it                         |
| in use         | A changed mode waits for the processes that hold the path; the row names them  |
| not empty      | The path holds files of its own, which the mount would hide; nothing is moved   |
| path taken     | Another file system is mounted there                                           |
| cannot mount   | The machine has no root half (`sudo bin/install-root` in the agent's folder)   |
| failed         | sshfs said why, or sshfs is not there and apt could not install it; tried again every minute |

A mounted row whose folder's machine is away says so: the folder answers nothing until it is
back.

## What it needs

- The agent, 1.38 or newer, on both machines; on `to` only, for a folder of serviceman's own.
- The agent's root half on `to`, which mounts over any folder of that machine. sshfs is installed
  with apt when it is missing.
- A path at `to` that is empty or not there yet, one level below the top at least (`/mnt/photos`),
  and none of the system's own folders.

## What it cannot do

- **A machine away is a folder that answers nothing.** The files are on the other machine.
- **Two agents that cannot reach each other go through serviceman.** Then a mount between two
  VPSes is as fast as their links to serviceman, not as the link between them; the row says so,
  and why.
- **A database does not go in it.** SQLite and its like want a local disk.

## For the operator

| Where                                         | What                                               |
|-----------------------------------------------|----------------------------------------------------|
| `mounts` in serviceman.json                   | The mounts ([Config](config.md#mounts))            |
| `<the agent's folder>/mounts/*.sock`          | The sockets sshfs dials, the agent's user's alone; in the temp folder's `serviceman-mounts-<uid>/` when that path is too long for a socket file |
| `/var/lib/serviceman/mounts/table.json`       | The root half's table: what it mounts, and what each try said; root's |

The log lines are `mounts_*` and `mount_error` on serviceman, `mount_socket_*` and
`root_mounts_keep_*` on a machine ([The log](logs.md#mounts)).
