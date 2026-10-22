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
    ui/packages.js                the component
    ui/packages.css               the component's rules
    tests/packages_serve.test.js  the API over a fake read

## The API

Under the base the host mounts it at — serviceman's is `/api/v1/remotes/<name>/packages`.

| Door | What it does |
|---|---|
| `GET <base>` | what the host's `read()` answers, below |

    {at, manual_known, updates_known, commands: ['dpkg-query …', 'apt-mark showmanual', …],
     items: [{name, arch, version, size, section, summary, manual, held, broken,
              update: {version, security} or null}]}

- `size` is bytes, or null where dpkg does not know it; `arch` is said beside a name only when
  it is not the machine's own nor `all`.
- `manual_known: false` says apt-mark could not tell which were installed by hand;
  `updates_known: false` that the dry run could not say what an upgrade would bring. The page
  says so instead of showing every package as a need, or as up to date.
- **Refusals:** a read that throws is a 502 with its message, or the status the error carries;
  any other door or method is a 404.

## Plugging it into a host

    const packages_serve = require('../modules/packages/server/packages_serve');

    await packages_serve(req, res, {
        // -> {at, items, manual_known, updates_known, commands}
        read: () => ask_the_machine('package_list'),
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
with it: `list-tools`, `list-right`, `chip`, `seg`, `tag`, `muted`, `bad`; its table is the
page's `data_table.js` and its copy button the page's `command_copy.js`, imported from beside it.

## In serviceman

- `src/main/src/routes/handle_control_request.js` sends `/api/v1/remotes/<name>/packages…` to
  `packages_serve`, after its own refusals: no such machine, not connected, an agent from before
  the package list; its `read()` is the agent's `package_list`
- the agent's `package_list` (`src/agent/src/agent_package_list.js`) runs dpkg-query, apt-mark
  and `apt-get -s upgrade` as the agent's own user: none of it needs root, and the dry run reads
  the lists the last `apt-get update` left
- `src/main/public/remote_packages.js` is the Packages tab, which wraps the component and says
  why there is no list for a machine not seen yet or an agent older than it

## Tests

    node --test modules/packages/tests/*.test.js tests/agent_packages.test.js
