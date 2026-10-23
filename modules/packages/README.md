# packages

The packages of one machine, for a web page: every package dpkg keeps, what each is and how
much room it takes, which were installed by hand and which came along as something else's need,
which are held or half installed, and which an upgrade would move on, security ones marked. A
machine carries a few thousand, so a filter comes first and the table shows 300 rows until asked
for the rest.

It has two halves and knows nothing of where the machine is. The page half is a Vue component
that talks to an HTTP API under one base URL. The server half is that API, as one request
handler that asks the host to **read** the list. The host gives the read, mounts the handler at
the base, and decides who may ask.

serviceman is the first host: its Packages tab of a machine is this component, and the read is
`dpkg-query`, `apt-mark` and a dry-run `apt-get upgrade` run over there by the machine's agent.
Installing the updates is not here: it is serviceman's own, on a machine's Configure tab and
on Remotes.

## Layout

    server/packages_serve.js      the HTTP API, given read()
    server/packages_manifest.js   its kinds of items and the commands on them
    ui/packages.js                the component
    ui/packages.css               the component's rules
    tests/packages_serve.test.js  the API over a fake read

## The API

What it holds and does is written down in `server/packages_manifest.js`, for a host to route,
give rights and show by: its kinds of items and the commands on them, in
[the shape every module has](../../README.md#modules).

Under the base the host mounts it at — serviceman's is `/api/v1/remotes/<name>/packages`.

| Door | What it does |
|---|---|
| `GET <base>` | what the host's `read()` answers, below |
| `POST <base>/upgrade` | install everything that waits: the host's `upgrade()`, 202 once it has begun, with the stream of its lines where the host keeps one, `{started, stream, url}` |
| `GET <base>/upgrade` | how it goes: the host's `run()`, `{phase, lines, started_at, ended_at, error}` |
| `POST <base>/cancel` | stop it: the host's `cancel()` |

    {at, manual_known, updates_known, commands: ['dpkg-query …', 'apt-mark showmanual', …],
     items: [{name, arch, version, size, section, summary, manual, held, broken,
              update: {version, security} or null}]}

- `size` is bytes, or null where dpkg does not know it; `arch` is said beside a name only when
  it is not the machine's own nor `all`.
- `manual_known: false` says apt-mark could not tell which were installed by hand;
  `updates_known: false` that the dry run could not say what an upgrade would bring. The page
  says so instead of showing every package as a need, or as up to date.
- The upgrade is a run of minutes, so it outlives the request that started it: the host keeps
  it, and a page follows its stream, or reads the run back. A second one while one runs is the
  host's to refuse (serviceman's is a 409).
- **Refusals:** a read, an upgrade or a cancel that throws is a 502 with its message, or the
  status the error carries; a host that gives no `upgrade`, `run` or `cancel` answers 501 at
  their doors; any other door or method is a 404.

## Plugging it into a host

    const packages_serve = require('../modules/packages/server/packages_serve');

    await packages_serve(req, res, {
        // -> {at, items, manual_known, updates_known, commands}
        read: () => ask_the_machine('package_list'),
        upgrade: () => start_the_upgrade(),             // -> {started, stream, url}; optional
        run: () => the_upgrade_so_far(),                // -> {phase, lines, …}; optional
        cancel: () => stop_the_upgrade(),               // optional
        tail: '',                                       // the address after the base
    });

The page half: the host serves `ui/` and maps it in its import map:

    <link rel="stylesheet" href="/modules/packages/packages.css">
    {"imports": {"packages/": "/modules/packages/", "vue": "/vendor/vue.esm-browser.prod.js"}}

    import packages from 'packages/packages.js';

    <packages base="/packages" :offline="false" :connected_at="1761164000000"/>

`connected_at` changes each time the machine dials back in, and a read that failed while it was
away is read again then. `offline` greys Read again.

The host page gives the colours, as `--accent` and `--bad`, and the classes the component shares
with it: `list-tools`, `list-right`, `chip`, `seg`, `tag`, `muted`, `bad`; its list is the
page's `items_view.js`, imported from beside it, which draws the columns the manifest names (see
[the shape every module has](../../README.md#modules)): a header sorts by its column.

## In serviceman

- `src/main/src/routes/handle_control_request.js` sends `/api/v1/remotes/<name>/packages…` to
  `packages_serve`, once the machine is one it knows. Its `read()` is the agent's
  `package_list`, refused for a machine away or an agent from before it; `upgrade()` and
  `cancel()` are `apt_run` and `apt_cancel` (`src/main/src/helpers/`), which keep the run on the
  machine's state, say its lines in a stream (`/api/v1/streams/<id>`) as they come, put back
  the containers it stopped, and are what Remotes' Install updates uses for several machines at
  once; `run()` is that state, read even once the machine is away, with the stream's `url`
- the Configure tab of a machine (`remote_configure` in `src/main/public/serviceman.js`) reads
  the run once, follows its stream while it runs, and reads it again when it ends
- the agent's `package_list` (`src/agent/src/agent_package_list.js`) runs dpkg-query, apt-mark
  and `apt-get -s upgrade` as the agent's own user: none of it needs root, and the dry run reads
  the lists the last `apt-get update` left
- `src/main/public/remote_packages.js` is the Packages tab, which wraps the component and says
  why there is no list for a machine not seen yet or an agent older than it

## Tests

    node --test modules/packages/tests/*.test.js tests/agent_packages.test.js
