# docker

The containers of one machine for a web page: every one of them, running or not, each compose
project together, with its state, image, ports and how long it has been up — and the few things
done to them most often. A container is started, stopped or restarted; a compose project is
updated the way it is by hand in its folder, its output shown step by step. A running
container opens in place: its files through the File Manager module, a shell in it through the
Terminal module. Beside the containers, tabs list the images, volumes and networks, each with
the containers that use it, to remove what nothing uses or prune it all at once.

It knows nothing of where the machine is. The host gives two ways to reach its docker:
`connect()` opens a stream to the Engine API, and `run(argv)` runs its docker command, for what
only the command does — compose. Only the calls below go through; the engine itself, which is
root on that machine, is never handed out.

serviceman is the first host: its Docker tab on a machine reaches the engine over the link the
machine's agent dialled, and runs compose as the agent's docker command.

## Layout

    server/docker_serve.js   the HTTP API, given connect and run
    server/docker_manifest.js its kinds of items and the commands on them
    server/container_disk.js a File Manager disk inside a container, over the Engine API alone
    ui/docker.js             the component
    ui/docker.css            the component's rules
    tests/                   the API over a fake engine and a fake run

## The API

What it holds and does is written down in `server/docker_manifest.js`, for a host to route,
give rights and show by: its kinds of items and the commands on them, in
[the shape every module has](../../README.md#modules).

Under the base the host mounts it at — serviceman's is `/api/v1/remotes/<name>/docker`:

| Door | What it does |
|---|---|
| `GET <base>/containers` | `{items: [{id, name, image, state, status, created_ms, ports, project, service, dir, own}]}` |
| `POST <base>/containers/<id>/start` | starts it; one already running is fine as it is |
| `POST <base>/containers/<id>/stop` | stops it |
| `POST <base>/containers/<id>/restart` | restarts it |
| `POST <base>/projects/<project>/update` | `docker compose pull`, then `up -d`: only what changed is made again |
| `POST <base>/projects/<project>/recreate` | `docker compose pull`, `down`, `up -d`: every container is made again |
| `GET <base>/images` | `{items: [{id, tags, size, created_ms, used_by, dangling, read_only}]}` |
| `POST <base>/images/<id>/remove` | takes it away; one a container was made from is refused (409) |
| `POST <base>/images/<id>/pull` | pulled again under its first name: text, a line when a layer says something new, then `done` or `failed` |
| `POST <base>/images/prune` | the dangling ones; `?all=1` every one no container was made from — one at a time, with its progress |
| `GET <base>/volumes` | `{items: [{name, driver, created_ms, project, used_by, mountpoint, mounts: [{id, name, running, destination}]}]}` |
| `POST <base>/volumes/<name>/remove` | takes it away with what is in it |
| `POST <base>/volumes/prune` | every volume no container mounts, with its progress |
| `POST <base>/volumes/<name>/open` | a helper container that mounts it: `{id, path}` |
| `POST <base>/volumes/<name>/close` | the helper killed and removed |
| `GET <base>/networks` | `{items: [{id, name, driver, subnet, project, used_by, builtin}]}` |
| `POST <base>/networks/<id>/remove` | takes it away; the built-in ones have no button |
| `POST <base>/networks/prune` | every network no container is on, with its progress |

`used_by` is worked out here from the containers, since the engine's lists do not say it (or
say -1). An image in a store podman may only read is marked `read_only` and keeps no Remove.

A project's folder and compose files come from its containers' own labels
(`com.docker.compose.project.working_dir`, `…config_files`), never from the page, and each
step is `docker compose -p <project> -f <file in full>… <step>` — the form both docker compose
and podman-compose take, the folder found from the first file; a project
whose containers do not say where they came from has no actions. A long action — a project's
update, a pull, a prune — answers as it goes, one JSON object a line: `{text}` for what it
printed, `{step, steps, name}` for the step it is on, `{progress: {done, total, unit}}` for how
far it is (a pull adds up its layers' bytes; a prune counts what it took, one at a time), and
last `{end: done | failed, said}`. A host that keeps streams (`stream` below) gets those lines
in one, and the answer is at once `202 {stream, url}`: the action goes on when the page goes,
and the page reads it at `url`; given `streams`, a page that opens finds one still running and
shows it again from its first line. Without, the lines are the answer itself. The page draws it
as one panel: a spinner and the time so far, the step, a bar with its percent and the time left
at the rate so far, and the log; every other button is greyed until it ends. An engine that cannot be reached, or refuses, is a 502 with `{error}`.

## A container's files and shell

`container_disk(connect, id)` is a disk the File Manager module takes (see its README), made
of the Engine API alone: nothing is installed in the container and nothing is mounted.

- a folder is listed by `find <dir> -mindepth 1 -maxdepth 1 -exec stat -L -c … {} +` run in the
  container — busybox has both — so a container with no shell has no listing
- a name is weighed by the header docker puts on its archive (`HEAD /containers/<id>/archive`),
  and a link is followed to the file it names, for its size and for reading
- a file is read out of its archive, a byte range sliced from it; a file is written as an
  archive of one entry docker unpacks (`PUT …/archive`), through a link, keeping the mode of the
  file it replaces; the length must be known first, as an upload's is
- rename, delete, new folder and a tar of several names are `mv`, `rm -rf`, `mkdir -p` and
  `tar -cf -` run in it, as the container's own user
- many files as one tar go to docker's own unpack (`PUT …/archive`) as the body comes, with its
  length when the request said one, into the folder, made with `mkdir -p` first when it is not
  there; docker keeps the tar's times, and the counts in the answer are the File Manager's own
- the room left on a folder's disk is `df -Pk` and `df -Pi` run in it, at the nearest folder
  that is there; a `df` with no `-i` says no inodes (null), and a container with no `df` is a
  502
- it keeps no parts, so a big file goes up in one piece

A volume's Files opens the same File Manager: through a running container that mounts it, at
the path it sees it under; otherwise through a **helper container** — busybox (pulled the first
time), labelled `docker-module.helper=volume`, mounting the volume at `/volume` and sleeping an
hour with `AutoRemove`, so docker removes it by itself if nobody closes it. The page closes it on
the way back to the list (`POST <base>/volumes/<name>/open`, `…/close`). Helpers are in no list
and in no "used by". The folder on the machine is not used: a rootful docker keeps it under
`/var/lib/docker`, where only root may look.

Before the File Manager is shown in place of the list, the page reads the folder once; one
that refuses (a container with no `find`, say) leaves the list where it is, with the reason.
The tab last shown is kept for the page, whichever machine it shows next, and for a reload.

The page shows Files and Shell on each running container when the host gives `files_base` and
`shell_url`; the shell is the host's own door, which joins `docker exec` to the Terminal module
(`terminal_attach`). The page imports both modules, `file_manager/` and `terminal/`, from the
host's import map.

## Plugging it into a host

    const docker_serve = require('../modules/docker/server/docker_serve');

    // every request under /docker goes to the module; the host checks who may ask first
    await docker_serve(req, res, {
        connect: () => net.connect('/var/run/docker.sock'),
        run: argv => run_docker(argv),        // -> {ok, code, stdout, stderr}
        tail: '/containers',                  // the address after the base
        own: v => v.startsWith('serviceman-'), // containers someone else runs: shown, no actions
        // optional: where a long action says its lines, kept by the host -> {id, url, write, end}
        stream: title => a_stream_kept(title),
        log: function (event, fields) {
        },
    });

The page half: the host serves `ui/` and maps it, with Vue, in its import map:

    <link rel="stylesheet" href="/modules/docker/docker.css">
    import docker from 'docker/docker.js';

    <docker base="/docker" :offline="false" :theme="theme" :files_base="v => '/docker/containers/' + v.id + '/fs'" :shell_url="v => '/shell?container=' + v.id" streams="/streams"/>

`streams`, optional, is where the host lists its streams, `GET streams?base=<base>` →
`{items: [{title, url, started_at, ended_at}]}`.

The host page gives the colours (`--panel`, `--line`, `--muted`) and the classes the module
shares with it: `card`, `list-head`, `list-acts`, `list-table`, `dot`, `muted`, `bad`,
`primary`, `danger`. Its four lists are the page's `items_view.js`, given the items the module
reads, which draws the columns the manifest names: containers as a tree, each compose project a
branch that folds, its containers under it, and a container of none a root.

## In serviceman

- `src/main/src/routes/handle_control_request.js` sends `/api/v1/remotes/<name>/docker…` to
  `docker_serve`: `connect` is a stream through the link to the socket the agent reports
  (`docker_exec_connect`), `run` is the agent's docker command (`docker_shell`), and
  serviceman's own containers, `serviceman-…`, are shown without actions — their service
  starts and stops them; `stream` is one of serviceman's (`stream_open`), read at
  `/api/v1/streams/<id>`
- `/api/v1/remotes/<name>/docker/containers/<id>/fs…` is the File Manager's API over
  `container_disk`; `/api/v1/shell?remote=<name>&container=<id>` is a shell in it
- `src/main/public/remote_docker.js` is the Docker tab of a machine, which wraps the component
  and gives it `streams="/api/v1/streams"`
- `src/main/public/index.html` loads the css and maps `docker/`; the control server serves
  `ui/` at `/modules/docker/`

## Not yet

- a step's output comes when the step ends, not line by line
- logs, inspect, the size of a volume, pull of a new image by name, run

## Tests

    node --test modules/docker/tests/*.test.js
