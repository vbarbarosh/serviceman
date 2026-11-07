# vulnerabilities

The critical CVEs that hit one Ubuntu machine, for a web page, as Ubuntu's own list says them:
what each hits (the kernel, or a package), its score, what mends it (a fix out to install, a
restart into the fixed kernel, a fix only Ubuntu Pro has, or no fix yet), and which are new.

The list is Canonical's CVE file of the machine's release, the one OpenSCAP reads,
`https://security-metadata.canonical.com/oval/com.ubuntu.<codename>.cve.oval.xml.bz2`: some
11 MB packed and 240 MB of XML, written about once a day. It is asked for whole, so nothing about
the machine leaves its host; read a line at a time while bunzip2 unpacks it, only its critical
CVEs kept (a hundred or so, 800 KB); asked again an hour later, and only taken when it changed
(`If-Modified-Since`). The machine is asked for its release, its running kernel and the version
of each package dpkg has installed, and its CVEs are worked out on the host.

Only Ubuntu's critical CVEs: a 24.04 machine on kernel 6.8.0-147 was hit by 72 of them on
2026-11-07, every one in the kernel with no fix out yet, and by 1,651 high ones, nearly all the
same kind. Their fixes, once out, count among the security updates apt has waiting.

It has two halves and knows nothing of where the machine is. The page half is a Vue component
that talks to an HTTP API under one base URL. The server half is that API, as one request
handler that asks the host to **read** the machine's CVEs, and the parts a host reads them with:
the list, the match and the items.

## Layout

    server/oval_critical_reader.js       Canonical's file, a line at a time -> its critical CVEs
    server/vulnerabilities_feed.js       the file of one release: asked, unpacked, kept in a folder
    server/debian_version_compare.js     two versions compared as dpkg compares them
    server/vulnerabilities_match.js      the critical CVEs and a machine -> the ones that hit it
    server/vulnerabilities_items.js      those, as a page shows them: what, fix, new, the order
    server/vulnerabilities_serve.js      the HTTP API, given read()
    server/vulnerabilities_manifest.js   its kind of items, read and nothing else
    ui/vulnerabilities.js                the component
    ui/vulnerabilities.css               the component's rules
    tests/vulnerabilities.test.js        all of the above, over a small file of Canonical's shape

## The API

What it holds is written down in `server/vulnerabilities_manifest.js`, for a host to route,
give rights and show by: one kind, read only, in
[the shape every module has](../../README.md#modules).

Under the base the host mounts it at — serviceman's is `/api/v1/remotes/<name>/vulnerabilities`.

| Door | What it does |
|---|---|
| `GET <base>` | what the host's `read()` answers, below |

    {at, reason, codename, kernel, list: {generated, checked_at, error}, commands: [],
     items: [{id, score, published, description, url, state, what, fix, new, found_at, fix_at,
              stopgap, pending}]}

- `reason` says why nothing could be judged (not Ubuntu, no dpkg, an agent from before, a list
  that could not be read), `items` then empty; null otherwise.
- `state` is `fix_out` (install the updates; for a kernel, then restart), `restart` (the fixed
  kernel is installed and not running yet), `pro` (only Ubuntu Pro's archive has a fix) or
  `no_fix`; `fix` says it in a line, with the versions.
- `new`: found since the host last marked the machine's CVEs seen; `found_at` and `fix_at` are
  when the host first found it, and since when its fix is out, or null where it keeps none.
- `stopgap` and `pending` are what Ubuntu's own page of the CVE adds, where the host asked it:
  the mitigation Ubuntu gives until the fix, and the version the fix waits in.
- **Refusals:** a read that throws is a 502 with its message, or the status the error carries;
  any other door or method is a 404.

## Plugging it into a host

    const vulnerabilities_feed = require('../modules/vulnerabilities/server/vulnerabilities_feed');
    const vulnerabilities_items = require('../modules/vulnerabilities/server/vulnerabilities_items');
    const vulnerabilities_match = require('../modules/vulnerabilities/server/vulnerabilities_match');
    const vulnerabilities_serve = require('../modules/vulnerabilities/server/vulnerabilities_serve');

    // {codename, url, checked_at, modified, generated, cves, error}; fetch and unpack optional
    const list = await vulnerabilities_feed({dir: '/var/lib/host/vulnerabilities', codename: 'noble'});
    const matched = vulnerabilities_match(list.cves, {kernel: '6.8.0-147-generic', packages: {bash: '5.2.21-2ubuntu4'}});
    const items = vulnerabilities_items(matched, {codename: 'noble', found: {}, seen_at: null, notes: () => null});

    await vulnerabilities_serve(req, res, {
        read: async () => ({at: Date.now(), reason: null, codename: 'noble', kernel, list, items, commands: []}),
        tail: '',                                       // the address after the base
    });

bunzip2 is the host's: `bunzip2`, `bzip2` or `busybox bunzip2`, the first it has (Alpine's
busybox has one). A host without any says so in `error`.

The page half: the host serves `ui/` and maps it in its import map:

    <link rel="stylesheet" href="/modules/vulnerabilities/vulnerabilities.css">
    {"imports": {"vulnerabilities/": "/modules/vulnerabilities/", "vue": "/vendor/vue.esm-browser.prod.js"}}

    import vulnerabilities from 'vulnerabilities/vulnerabilities.js';

    <vulnerabilities base="/vulnerabilities" :offline="false" :connected_at="1761164000000"/>

The host page gives the colours, as `--accent` and `--muted`, and the classes the component
shares with it: `chip`, `tag`, `muted`, `bad`, `warn`; its list is the page's `items_view.js`,
imported from beside it, which draws the columns the manifest names. A click on a row shows what
the CVE is and Ubuntu's stopgap, where it gives one; the CVE's name opens Ubuntu's page of it.

## In serviceman

- each machine's hourly Security look (`security_of_remote`) asks its agent's
  `package_versions` (`src/agent/src/agent_package_versions.js`: `/etc/os-release`, the running
  kernel, dpkg's status file, no program run) and holds it against its release's list, kept in
  the state folder's `vulnerabilities/` (`vulnerabilities_of_remote`)
- `vulnerabilities_kept` keeps in the state folder's `vulnerabilities.json` when each CVE was
  first found on each machine, since when its fix is out, and when its CVEs were last seen;
  `vulnerabilities_notes` asks Ubuntu's page of each CVE with no fix that hits a machine, two at
  a time, once a day, for the stopgap and the pending version
- the Security page's Vulnerabilities column (`security_checks`), Health's problems for the new
  ones and the fixes out (`problems_of_vulnerabilities`), and `POST /api/v1/vulnerabilities/seen`
  when the problems bar is closed on them
- `src/main/public/remote_vulnerabilities.js` is a machine's Vulnerabilities tab; module-host
  (`bin/run-local`) reads this computer the same way, with nothing ever new

## Tests

    node --test modules/vulnerabilities/tests/*.test.js tests/vulnerabilities.test.js
