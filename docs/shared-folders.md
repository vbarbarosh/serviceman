# Shared folders

A shared folder is one folder, the same on every machine that mounts it. Each machine has it at
a path of its own, `/srv/media` on one and `/var/www/site/media` on another, read-write here and
read-only there. A file written on one is there when another opens it.

The page is **Shared folders** in the rail. It has three parts: the home, the folders, and a
row per machine under each folder.

## The home

The folders live on one of your VPSes, their **home**. Two containers run there:

- **Redis** keeps the names, the folders and the sizes: about 300 bytes a file.
- **Garage** keeps the bytes, as an S3 bucket.

Each machine mounts the folders with [JuiceFS](https://juicefs.com): it asks Redis for the
names and Garage for the bytes, and keeps what it read in a cache of its own.

**Set up the home** on the page picks a machine that is online and has docker, the agent's root
half and a tailnet address. serviceman makes every password and key itself and keeps them in
`data/shared_folders.json`, mode 600; the page never sees one. Then the machine's root half:

1. writes the configs under `/var/lib/serviceman/shared/home/`, root's alone;
2. starts `serviceman-shared-redis` (`redis:7.4.12`) and `serviceman-shared-garage`
   (`dxflrs/garage:v2.5.0`), each published on the machine's tailnet address only, on ports
   16379 and 13900, with `--restart unless-stopped`;
3. fetches juicefs 1.4.2 from its release on GitHub and runs it only when its sha256 is the one
   the release published;
4. makes the volume, encrypted (below), once: a volume already in Redis is never made again;
5. mounts the whole volume at `/var/lib/serviceman/shared/all`, where only root goes. Folders
   are made and deleted there.

A home that failed may be set up again, there or on another machine. A home that is ready stays
where it is.

## A folder on a machine

**+ New folder** makes a folder of the volume: up to 40 small letters, digits and hyphens. It
belongs to the person whose agent runs on the home, by number: uid 1000 there is uid 1000 on
every machine.

**Mount on a machine…** picks the machine, the path and the mode. serviceman sends the machine
its whole table of mounts, the way it sends the door table. The agent keeps the table, root's
alone, and its root half mounts each folder:

    juicefs mount -d --subdir /media [--read-only] redis://100.64.0.20:16379/1 /srv/media

The password and the passphrase reach juicefs through its environment, never its argv, which
every user of the machine can read. The root half looks at the table on its own every minute,
so after a reboot, or after the home was away, everything is mounted again without serviceman.

A machine needs the agent's root half to mount (`sudo bin/install-root` in the agent's folder).
A machine that is away keeps its row and is mounted the moment its agent dials in.

### What a row says

| State           | What it means                                                                 |
|-----------------|-------------------------------------------------------------------------------|
| mounted         | It is there, as the row says                                                  |
| on its way      | Sent to the machine, not answered yet                                         |
| waiting         | The machine is away, or the home is not set up yet                            |
| in use          | A changed mode or folder waits for the processes that hold the path; the line under the row names them and says the mode it still has |
| not empty       | The path holds files of its own: the folder mounted there would hide them. Nothing is moved; empty it, or pick another path |
| path taken      | Another file system is mounted at the path                                    |
| cannot mount    | The machine has no root half, or an agent from before shared folders          |
| failed          | juicefs said why, under the row; the machine tries again every minute         |

A path is refused when it is not a full path, is `/` or a folder at the top (`/srv`), or is
under the system's own folders: `/bin`, `/boot`, `/dev`, `/etc`, `/lib`, `/proc`, `/run`,
`/sbin`, `/sys`, `/usr`, `/var/lib/serviceman`. Two folders on one machine never share a path,
nor sit one inside the other.

**Unmount** takes the folder off. One that something holds stays until it is free.
**Delete…** asks for the folder's name typed again, and only once no machine mounts it. juicefs
keeps the deleted files in its trash for a day.

## What is encrypted

| What                                  | How                                                        |
|---------------------------------------|------------------------------------------------------------|
| Everything between machines           | The tailnet, WireGuard                                     |
| The files' bytes, in the bucket       | AES-256-GCM, on each machine before they leave it          |
| The key to them                       | In Redis, locked by a passphrase serviceman keeps          |
| The names, folders and sizes          | **Plain**, in Redis on the home's disk                     |
| Each machine's read cache             | **Plain**, on its disk, root's alone                       |

Encryption is chosen when the volume is made; juicefs cannot add it later, so it is always on.
The mounted folder is plain to its machine, as any disk is.

## Read-only

Read-only is a mount flag. It keeps every program on that machine from writing, a service and
a slip of the hand alike. root on that machine holds the same password as every other machine,
and can mount the folder read-write by hand.

## What it cannot do

- **A machine offline sees an empty folder.** The folder is on the network, not on the disk.
- **The home holds the only copy.** Garage runs on one machine, and the files are as safe as its
  disk. juicefs copies the names into the bucket every hour; Redis keeps its own on disk as
  well.
- **A database does not go in it.** Postgres, SQLite and their like want a local disk.

## For the operator

| Where                                    | What                                                   |
|------------------------------------------|--------------------------------------------------------|
| `data/shared_folders.json` (serviceman)  | The home, its secrets, the folders, the mounts; 600     |
| `/var/lib/serviceman/shared/table.json`  | A machine's table of mounts, and what each try said; root's |
| `/var/lib/serviceman/shared/juicefs.log` | What juicefs said on that machine                      |
| `/var/lib/serviceman/shared/home/`       | The home's Redis and Garage: configs and data          |
| `docker logs serviceman-shared-redis`    | Redis on the home; `…-garage` for Garage               |

The log lines are `shared_*` on serviceman and `root_shared_keep_*` on a machine
([The log](logs.md)). A restart of serviceman or of an agent unmounts nothing: the root half
keeps the mounts, and docker keeps the home's containers.
