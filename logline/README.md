# ClickStack playground for grouped text logs

This setup is centered on the format in [`logs.md`](logs.md):

```text
2026/08/15 00:48:05 [group_uid][subject] Optional description
2026/08/15 00:51:06 [group_uid2][spawn] parent=group_uid1
```

The file can grow indefinitely. A small OpenTelemetry edge agent tails each
`*.log` file in `./log-input`, parses every line, and forwards it over OTLP/HTTP
to ClickStack's bundled collector. ClickStack inserts the records into
`default.otel_logs` and provides the search UI.

The same agent also discovers running Docker containers and tails their
standard output/error when Docker uses its `json-file` logging driver. Each
container appears as a separate ClickStack service named after the container.

This is a local playground, not a production deployment. Published ports bind
only to `127.0.0.1`.

## How each line is stored

The collector keeps the complete original line in `Body` and extracts fields
into `LogAttributes`:

| Text field | ClickHouse field |
| --- | --- |
| `2026/08/15 00:48:05` | `Timestamp` |
| `group_uid` | `LogAttributes['group_uid']` |
| `subject` | `LogAttributes['subject']` |
| optional text | `LogAttributes['description']` |
| `parent=...` on a `spawn` line | `LogAttributes['parent_group_uid']` |
| input filename/path | `LogAttributes['log.file.name']`, `LogAttributes['log.file.path']` |
| configured source name | `ServiceName = 'grouped-text-log'` |

The timestamp is currently interpreted as UTC because the text format has no
timezone. If the producer writes local wall-clock time, change `location: UTC`
in [`config/otel-collector.yaml`](config/otel-collector.yaml) to
its IANA timezone, such as `Europe/Prague`.

## Collect local Docker container logs

This is enabled by default. The agent mounts these host resources:

- `/var/lib/docker/containers` read-only, to tail Docker JSON log files
- `/var/run/docker.sock`, to discover names, IDs, and images as containers
  start and stop

First find the paths used by the active Docker daemon:

```bash
docker info --format 'root={{.DockerRootDir}}'
docker inspect -f 'log={{.LogPath}} driver={{.HostConfig.LogConfig.Type}}' CONTAINER
docker context inspect "$(docker context show)" --format '{{.Endpoints.docker.Host}}'
```

If the root is not `/var/lib/docker`, create `.env` beside
`docker-compose.yml`. For example, Docker installed through Snap commonly uses:

```dotenv
DOCKER_ROOT_DIR=/var/snap/docker/common/var-lib-docker
DOCKER_SOCKET_PATH=/var/run/docker.sock
```

Use the reported root directory, not necessarily that Snap example. For a
rootless context, remove the `unix://` prefix from the reported endpoint before
putting its socket path in `DOCKER_SOCKET_PATH`. See
[`config/docker.env.example`](config/docker.env.example) for the defaults.
Compose maps the selected host `containers` directory to the fixed path
`/var/lib/docker/containers` inside the agent, which is the path expected by
the collector configuration.

The collector and ClickStack containers are excluded to prevent a logging
feedback loop. Newly discovered files start at their end: existing historical
output is not imported, but subsequent stdout/stderr is collected. This also
means output written while `log-agent` is stopped is not backfilled.

Check which logging driver a container uses:

```bash
docker inspect -f '{{.Name}} driver={{.HostConfig.LogConfig.Type}} path={{.LogPath}}' CONTAINER
```

An empty driver value inherits Docker's daemon default. A non-empty `LogPath`
ending in `-json.log` is what this setup expects. Containers using `journald`,
`local`, `none`, or a remote logging driver need a receiver for that backend
instead.

After changing this configuration, recreate only the agent:

```bash
docker compose up -d --force-recreate log-agent
docker compose logs --tail=100 log-agent
```

Generate a test line from any shell-based container:

```bash
docker exec CONTAINER sh -c 'echo clickstack-docker-test >&2'
```

Then list the services reaching ClickHouse:

```bash
docker compose exec clickstack clickhouse-client --query "
SELECT ServiceName, count(), max(Timestamp)
FROM default.otel_logs
GROUP BY ServiceName
ORDER BY max(Timestamp) DESC
"
```

Docker records carry `container.id`, `container.name`, and
`container.image.name` in `ResourceAttributes`; their stdout/stderr stream is
available as a log attribute. For example:

```sql
SELECT
    Timestamp,
    ServiceName,
    ResourceAttributes['container.image.name'] AS image,
    LogAttributes['log.iostream'] AS stream,
    Body
FROM default.otel_logs
WHERE ServiceName = 'myapp-worker-1'
ORDER BY Timestamp DESC
LIMIT 50;
```

Mounting the Docker socket is security-sensitive: read-only bind-mount syntax
does not make the Docker API itself read-only. Only use this local setup with a
trusted collector image and configuration. Remove the socket mount and the
Docker receiver if container-name discovery is not worth that access.

## Lines: the endpoint machines send to

`lines/` is Logline's one door for machines elsewhere: `POST /lines` with an array of
`{time, labels, line}`, and a token that works only from the addresses it was issued for.
serviceman asks for the tokens and hands them to its machines; the design is in serviceman's
`notes/logline.md`.

| Route                  | Who asks       | What it does                                                        |
|------------------------|----------------|---------------------------------------------------------------------|
| `POST /lines`          | a machine      | Stores a batch whole, or answers why not. The same bytes sent twice are stored once. |
| `POST /tokens`         | serviceman     | `{name, ips}` → `{name, token}`: a token bound to those addresses.  |
| `DELETE /tokens/<name>`| serviceman     | Takes a token back.                                                 |

`POST /tokens` and `DELETE` need `ADMIN_TOKEN`, from an address in `ADMIN_IPS`. Set both in
`.env`, with `TAILSCALE_IP` — port 3000 is opened on that address and nowhere else, with nothing
in front of it, so every caller arrives with its own address: `lines` runs on the machine's own
network, not behind Docker's, whose rules a Tailscale update can put out of order (then every
machine arrives from Docker's address and every token is refused). The firewall lets the port in
on the tailnet: `sudo ufw allow in on tailscale0 to any port 3000 proto tcp`. See
[`config/docker.env.example`](config/docker.env.example). None of the three is needed for the
rest of the stack: without them `lines` listens on this machine alone and issues no tokens.

Each line lands in `default.otel_logs`: `time` as `Timestamp`, `line` as `Body` untouched, the
`service` label as `ServiceName`, and the rest where the log-ui reads them (`host` as
`host.name`, `container` as `container.name`, `stream` as `log.iostream`). The name of the token
is the `remote`. A line in the rules' form, `[group_uid][sender] details`, also has its fields in
`LogAttributes`.

The endpoint writes as ClickHouse user `lines` ([`config/clickhouse.xml`](config/clickhouse.xml)):
insert into `otel_logs`, and the one setting that makes a resend harmless — nothing else.

```bash
cd lines && bin/test                              # unit tests
CLICKHOUSE=http://127.0.0.1:8123 bin/test         # and against a real ClickHouse
```

## 1. Start ClickStack

You need Docker with the Compose plugin.

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Open <http://localhost:8080>. This deployment uses ClickStack Local, so
authentication is disabled and there is no user-registration step.

ClickStack Local preconfigures its own UI connection. Its underlying `default`
ClickHouse HTTP account is password-protected, so do not create a manual
`default`/empty-password connection. The custom viewer below uses its separate
passwordless, read-only account instead.

Useful endpoints:

| Endpoint | Purpose |
| --- | --- |
| <http://localhost:8080> | ClickStack UI |
| <http://localhost:8081> | Focused custom log viewer |
| `http://localhost:4318` | OTLP/HTTP ingestion for other applications |
| `localhost:4317` | OTLP/gRPC ingestion for other applications |
| <http://localhost:8123/play> | ClickHouse Play SQL UI |
| `http://localhost:8123` | ClickHouse HTTP API |

Port `9000` is intentionally not published because it is commonly taken by
PhpStorm/Xdebug. SQL examples use `docker compose exec` or HTTP
port `8123`, so the native port is unnecessary.

Local mode is intended only for demos, debugging, and development because
anyone who can reach the UI has access. The Compose ports remain bound to
`127.0.0.1` for that reason.

## Focused log viewer

Open <http://localhost:8081> for the compact workflow-oriented UI. It provides:

- one space-separated substring expression, with every token combined using
  `AND`; typing is applied automatically after a short debounce
- negative substring expressions: prefix a token with `!` to require that its
  substring is absent
- a Labels panel listing every label in the date range (`remote`, `host`,
  `service`, `container`, `image`, `stream`, and any other a machine sent) with
  its most frequent values and their line counts; click values to show only
  those lines: values of one label are combined with `OR`, different labels
  with `AND`. A value's count keeps every other filter but its own label's
  selection, so choosing a second host still shows how many lines it has. The
  box on top finds a label or value beyond the 40 listed. Changing `service` in
  Surroundings removes the original container lock and applies the new service
  to the log list and histogram
- one Time range field: quick ranges from the last 5 minutes to the last 30
  days, plus Today, Yesterday, This week and This month; or a typed From and To,
  each `2026-09-26 14:30`, `14:30` for today, `now-2h` (s, m, h, d, w) or `now`,
  in browser-local time. A range ending `now` follows live; paused, its label
  turns into the times it covers
- an adaptive filtered-events bar histogram; click a bar to zoom into it
- an oldest-to-newest virtualized log list; live mode follows the bottom and
  uses a quick scroll animation for new rows, while scrolling to the top
  prepends older pages without moving the current line
- configurable live polling interval from 1 to 300 seconds, persisted in
  `localStorage`, without rebuilding the entire list
- automatic live-follow pause as soon as the log list is scrolled
- the entry's labels, each one click from filtering by it, and the complete
  body in a click-through drawer
- line selection: drag over the list to draw a rectangle (it scrolls when held
  past the top or bottom edge); alone it replaces what is selected among the
  loaded lines, with Shift it adds, with Ctrl/Command it toggles.
  Ctrl/Command+click toggles one line, Shift+click selects from the last line
  picked, Ctrl/Command+A and the box in the header take every loaded line, and
  a plain click still opens the line. Selected lines stay selected across
  searches, so one export can gather lines from several; the toolbar says how
  many came from other searches. Copy them or save them as a file, oldest first, as Text (each
  line as shown, `[time]` in front, the way the rules write it), JSON Lines or
  a JSON array of `{time, labels, line}` — what the lines endpoint accepts,
  with the time to the nanosecond and the line as it was sent
- row-level investigation pivots: show the same container/service for two
  minutes before and after an entry plus matching `group_uid` entries within
  one hour, or show every entry with the same/parent `group_uid`;
  the original search is retained behind a **Back to search** action
- fallback extraction of `group_uid` and `subject` from valid bracketed Docker
  log syntax, so investigation works when those values are not OTel attributes
  without treating quoted source-code snippets as grouped log entries
- links that open it filtered: `?label=name:value` once per label (values of one
  label are any of them, different labels all of them), with `range=` naming a
  quick range — `15m`, `1h`, `24h`, `7d`, `today`, `yesterday`, … — or `from=`
  and `to=` for times. Labels alone open the last hour, following live:
  `http://localhost:8081/?label=remote:laptop&range=24h` is everything from the
  machine `laptop` over the last day. serviceman's pages link here this way
- URL-backed search state and a **Copy link** action that preserves the applied
  expression, selected labels, absolute date range, investigation scope, and
  opened log entry;
  live views are paused before copying so shared results do not drift
- optional ANSI escape removal for noisy container output
- an optional empty-body filter that ignores ANSI terminal sequences plus
  whitespace/control characters (including spaces, tabs, carriage returns,
  and newlines), persisted locally and included in copied URLs so the list and
  histogram use the same event population
- disk usage in the top bar, logs on disk and free space on the ClickHouse
  disk; click it for how the disk splits between the logs, the rest of
  ClickHouse (ClickStack's own tables, its `system` logs), everything else and
  what is free, the lines kept and since when, their size before compression,
  and the largest tables. It turns amber under 10% free and red under 5%. The
  `log_ui` user reads only the size columns of `system.parts` and
  `system.disks` for this, and table names, never another table's rows
- persistent light/dark theme selection (initially follows browser preference)

There is no Run button. Substring edits apply after 450 ms, ranges apply as
they are chosen, and Ctrl/Command+Enter remains available. The
`log-ui` container is excluded from Docker log collection so its ClickHouse
requests cannot match their own substring parameters and create a feedback
loop.

**Copy link** uses the origin currently open in the browser. A
`localhost:8081` link is therefore usable only on that same computer. For a
different person to open it, they must already have access to this UI through
an SSH tunnel, VPN, or authenticated reverse proxy; opening the UI through that
shared hostname makes copied links use it automatically. Do not expose the
passwordless local viewer directly to the public internet.

For example, this finds bodies containing both `cron` and `disk`, while
excluding any body containing `success`:

```text
cron disk !success
```

The UI sends parameterized substring and date values to ClickHouse through an
nginx same-origin proxy. Its port is bound to localhost because the proxy can
submit queries to ClickHouse; do not publish port 8081 to an untrusted network.

The proxy uses a dedicated passwordless `log_ui` ClickHouse account defined in
`config/clickhouse.xml`. That account accepts connections only
from private Docker networks, has `readonly=1`, and is granted `SELECT` only on
`default.otel_logs`. No password is stored in `.env`, JavaScript, or nginx. The
proxy also discards browser-supplied `Authorization` headers.

The page uses the Vue 3 global browser build directly from unpkg. There is no
Node.js dependency, package install, compilation, or asset build step.

After changing files in `./log-ui`, the bind mounts make a browser refresh
sufficient. The nginx config disables caching for the HTML, CSS, and JavaScript.
To create the service for the first time:

```bash
docker compose pull log-ui
docker compose up -d log-ui
docker compose logs --tail=50 log-ui
```

When adding or changing `config/clickhouse.xml`, recreate
ClickStack as well so ClickHouse reloads the user configuration:

```bash
docker compose up -d --force-recreate clickstack log-ui
```

## 2. Append logs

Your real producer can append directly to any file matching:

```text
./log-input/*.log
```

For example:

```bash
printf '%s\n' \
  '2026/08/15 00:48:05 [group_uid1][export_html5_begin] preset=web' \
  '2026/08/15 00:51:06 [group_uid2][spawn] parent=group_uid1' \
  '2026/08/15 00:51:07 [group_uid2][cronjob_clean_begin]' \
  >> log-input/application.log
```

The demo writer creates a complete parent/child lifecycle using current UTC
timestamps:

```bash
bash scripts/append-demo-group-logs.sh
```

Create a failed run:

```bash
bash scripts/append-demo-group-logs.sh error
```

The script prints the generated root and child group IDs. New lines normally
become searchable within a few seconds.

If the real application writes elsewhere, replace the
`./log-input:/var/log-input:ro` bind mount in
[`docker-compose.yml`](docker-compose.yml) with its host directory. Keep it
read-only inside the container.

## 3. Search in ClickStack

Open <http://localhost:8080>, select the **Logs** source, and use a recent time
range. Useful searches include:

```text
cronjob_clean_end_error
LogAttributes.subject:cronjob_clean_end_error
LogAttributes.group_uid:clean-20260815T005106-123-456
LogAttributes.parent_group_uid:export-20260815T004805-123-456
LogAttributes.description:*disk_full*
```

The first search matches the original line body. The others target parsed
attributes. Click a result to inspect all values.

Search is case-insensitive. Plain terms match whole tokens, quoted text matches
a phrase, and `AND`, `OR`, `NOT`, and `-` combine or exclude conditions. The
tokenizer splits on non-alphanumeric characters, so `cronjob_clean_end_error`
contains the tokens `cronjob`, `clean`, `end`, and `error`; plain `cron` does
not match it. ClickStack wildcard translation is not reliable for map
attributes, and some releases do not apply a bare trailing wildcard as
expected. Use SQL for substring matching instead.

For an arbitrary substring search, switch the UI query editor to SQL and use:

```sql
Body ILIKE '%cron%'
```

The equivalent direct ClickHouse filter is:

```sql
WHERE Body ILIKE '%cron%'
```

If `cron` must work as an ordinary full-text term, write it as a separate token
in the source data, for example `cron_job_clean_end_error`. The underscore is a
token separator, while `cronjob` is a single token.

## 4. Query with ClickHouse SQL

Start an interactive client inside the container:

```bash
docker compose exec clickstack clickhouse-client
```

### Recent parsed lines

```sql
SELECT
    Timestamp,
    LogAttributes['group_uid'] AS group_uid,
    LogAttributes['subject'] AS subject,
    LogAttributes['description'] AS description,
    LogAttributes['parent_group_uid'] AS parent_group_uid
FROM default.otel_logs
WHERE ServiceName = 'grouped-text-log'
ORDER BY Timestamp DESC
LIMIT 50;
```

### Every event for one group

```sql
SELECT Timestamp, LogAttributes['subject'] AS subject, Body
FROM default.otel_logs
WHERE ServiceName = 'grouped-text-log'
  AND LogAttributes['group_uid'] = 'group_uid2'
ORDER BY Timestamp;
```

### Find a group's parent and children

```sql
-- Parent of group_uid2
SELECT DISTINCT LogAttributes['parent_group_uid'] AS parent_uid
FROM default.otel_logs
WHERE LogAttributes['subject'] = 'spawn'
  AND LogAttributes['group_uid'] = 'group_uid2';

-- Direct children of group_uid1
SELECT
    LogAttributes['group_uid'] AS child_uid,
    min(Timestamp) AS spawned_at
FROM default.otel_logs
WHERE LogAttributes['subject'] = 'spawn'
  AND LogAttributes['parent_group_uid'] = 'group_uid1'
GROUP BY child_uid
ORDER BY spawned_at;
```

### Follow a child back to its source

Replace `group_uid3` with the group being investigated:

```sql
WITH RECURSIVE
edges AS
(
    SELECT
        LogAttributes['group_uid'] AS child_uid,
        LogAttributes['parent_group_uid'] AS parent_uid
    FROM default.otel_logs
    WHERE ServiceName = 'grouped-text-log'
      AND LogAttributes['subject'] = 'spawn'
      AND notEmpty(parent_uid)
    GROUP BY child_uid, parent_uid
),
lineage AS
(
    SELECT
        child_uid AS group_uid,
        parent_uid,
        toUInt32(0) AS depth,
        [child_uid] AS visited
    FROM edges
    WHERE child_uid = 'group_uid3'

    UNION ALL

    SELECT
        edge.child_uid AS group_uid,
        edge.parent_uid,
        toUInt32(lineage.depth + 1) AS depth,
        arrayPushBack(lineage.visited, edge.child_uid) AS visited
    FROM lineage
    INNER JOIN edges AS edge ON edge.child_uid = lineage.parent_uid
    WHERE lineage.depth < 99
      AND NOT has(lineage.visited, edge.child_uid)
)
SELECT depth, group_uid, parent_uid
FROM lineage
ORDER BY depth;
```

The depth limit and visited-array check protect the query from malformed cycles.

### Follow a root through every descendant

Replace `group_uid1` with a root group ID:

```sql
WITH RECURSIVE
edges AS
(
    SELECT
        LogAttributes['group_uid'] AS child_uid,
        LogAttributes['parent_group_uid'] AS parent_uid
    FROM default.otel_logs
    WHERE ServiceName = 'grouped-text-log'
      AND LogAttributes['subject'] = 'spawn'
      AND notEmpty(parent_uid)
    GROUP BY child_uid, parent_uid
),
groups AS
(
    SELECT
        'group_uid1' AS group_uid,
        toUInt32(0) AS depth,
        ['group_uid1'] AS visited

    UNION ALL

    SELECT
        edge.child_uid AS group_uid,
        toUInt32(groups.depth + 1) AS depth,
        arrayPushBack(groups.visited, edge.child_uid) AS visited
    FROM groups
    INNER JOIN edges AS edge ON edge.parent_uid = groups.group_uid
    WHERE groups.depth < 99
      AND NOT has(groups.visited, edge.child_uid)
)
SELECT
    events.Timestamp,
    groups.depth,
    groups.group_uid,
    events.LogAttributes['subject'] AS subject,
    events.LogAttributes['description'] AS description
FROM default.otel_logs AS events
INNER JOIN groups
    ON events.LogAttributes['group_uid'] = groups.group_uid
WHERE events.ServiceName = 'grouped-text-log'
ORDER BY events.Timestamp, groups.depth;
```

### Failed operations

```sql
SELECT
    Timestamp,
    LogAttributes['group_uid'] AS group_uid,
    LogAttributes['subject'] AS subject,
    LogAttributes['description'] AS description
FROM default.otel_logs
WHERE ServiceName = 'grouped-text-log'
  AND endsWith(subject, '_end_error')
ORDER BY Timestamp DESC;
```

### Lifecycle summary per group

```sql
SELECT
    LogAttributes['group_uid'] AS group_uid,
    min(Timestamp) AS first_event,
    max(Timestamp) AS last_event,
    dateDiff('second', first_event, last_event) AS elapsed_seconds,
    argMax(LogAttributes['subject'], Timestamp) AS latest_subject,
    countIf(endsWith(LogAttributes['subject'], '_end_error')) AS errors,
    count() AS event_count
FROM default.otel_logs
WHERE ServiceName = 'grouped-text-log'
GROUP BY group_uid
ORDER BY last_event DESC;
```

Run a one-off query without opening the client:

```bash
docker compose exec clickstack clickhouse-client \
  --query "SELECT count() FROM default.otel_logs WHERE ServiceName = 'grouped-text-log'"
```

## 5. Operational notes

Check the file agent first:

```bash
docker compose logs log-agent
```

It should start a `logs/grouped_text` pipeline without export or parsing errors.
Confirm both services are running with `docker compose ps`.

Malformed lines are retained as raw `Body` values because parsing uses `on_error: send_quiet`; their structured attributes will be empty. Find them with:

```sql
SELECT Timestamp, Body, LogAttributes['log.file.path'] AS file
FROM default.otel_logs
WHERE ServiceName = 'grouped-text-log'
  AND empty(LogAttributes['group_uid'])
ORDER BY Timestamp DESC;
```

The playground starts reading matched files from the beginning. The `log-agent` remembers offsets while it is running, but this minimal configuration does not persist file offsets across agent/container recreation. Recreating it can therefore ingest existing lines again. Before production use, enable persistent `file_storage`, define rotation/retention, and choose an event ID or deduplication policy.

There is an important modeling distinction: `group_uid` and `parent_group_uid` currently form a graph in log attributes. They are not OpenTelemetry trace/span IDs. If groups represent timed operations and you control the producer, emitting real OTel spans in addition to logs would enable ClickStack's native trace waterfall while retaining these detailed log events.

Stop the service:

```bash
docker compose down
```

This keeps ClickHouse data and ClickStack application state in the named volumes. To stop the service and permanently remove all persisted data:

```bash
docker compose down -v
```

## References

- [ClickStack custom collector configuration](https://clickhouse.com/blog/whats-new-in-clickstack-september-2025#custom-collector-configuration)
- [OpenTelemetry filelog receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- [OpenTelemetry regex parser](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/stanza/docs/operators/regex_parser.md)
- [ClickStack log schema](https://clickhouse.com/docs/clickstack/ingesting-data/schemas)
- [ClickStack search syntax](https://clickhouse.com/docs/clickstack/features/search)
