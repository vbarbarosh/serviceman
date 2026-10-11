# Rules audit — 2026-10-08

Repository: `/app` (serviceman), not a git checkout: no branch, HEAD or history to cite.
Rulebook: vbarbarosh/rules at `7c0b16e` (2026-10-08 00:00 Europe/Chisinau), 264 rules in 17 groups.
Times are Europe/Chisinau.

## Scope

- **The rulebook's lint** (`eslint.projects.config.js`) over every lintable file: src, tests, logline/lines, logline/log-ui/app.js, modules, examples, web-terminal; 461 files. 14 findings, all `rules/vue-style-conventions` on hand-written transitions: 13 in `src/main/public/serviceman.css`, which the README explains (plain CSS, no preprocessor for the mixin), and 1 in `web-terminal/public/web_terminal.css:96`.
- **Every other rule read against the code** by four readers, one set of groups each (A: CORE NAME VAR FN; B: FMT FLOW FILE, with an AST scan of 457 files; C: PROJ LOG REL GIT DOC, with a script over all of `data/logs/2026*.log`; D: CSS UI VUE SQL). Each finding cites the line it was read on; the high ones and a sample of the rest were re-read for this note.
- **Not checked:** GIT rules and CORE-01 need history, and there is no `.git`. Nothing was run for this audit beyond the lint and the log scan; the code was read, not driven.

## Verdict

| Kept | Broken | Borderline | Does not apply |
|---:|---:|---:|---:|
| 100 | 104 | 20 | 40 |

The code is uniform in the ways the lint enforces, and in most of what it cannot. What breaks is mostly naming and formatting habits repeated across the repo (parentheses around operands, `out`, plural lookups), one log line that writes secrets, the docker layout of the example compose file, and the page's "are you sure?" dialogs.

## Finding register

| Id | Severity | Rules | Area | Title | How many |
|---|---|---|---|---|---|
| SM-69 | high | LOG-16 | logs | Service env values, secrets included, are written into the logs | 2 files hold a live secret; every start writes it again |
| SM-70 | high | PROJ-18, PROJ-19 | layout | The compose example mounts /data, but the image keeps its state in /app/data | 3 places |
| SM-71 | high | PROJ-03 | bin | bin/watch starts a file that does not exist; run, build, watch do not wrap npm | 3 verbs |
| SM-72 | medium | PROJ-18 | layout | A hand-run agent keeps its state beside its own file | 3 leftovers |
| SM-73 | medium | LOG-17 | logs | Command output is logged as bare details and forges tags | 13,797 lines in one day; 4 call sites |
| SM-74 | medium | LOG-10, LOG-06, LOG-14 | logs | Begins and ends that do not pair | 9 senders |
| SM-75 | medium | LOG-08 | logs | One sender name written from several call sites | 18 senders |
| SM-76 | medium | LOG-07 | logs | A call to an agent does not carry the caller's group, so the trace breaks at the link | 1 place, every remote call |
| SM-77 | medium | LOG-04 | logs | Lines on stdout carry the time even under docker | 2 places |
| SM-78 | medium | PROJ-04, REL-01, REL-02 | release | The release writes the agent bundle into a committed file at the root | 1 pipeline |
| SM-79 | medium | PROJ-07 | layout | config/index.js reads no environment; the env is read all over | 4+ places |
| SM-80 | medium | UI-15, UI-16 | page | "Are you sure?" steps, and no Undo anywhere | 11 dialogs |
| SM-81 | medium | UI-02 | page | The theme switch does not show the current theme | 4 pages |
| SM-82 | medium | UI-03 | page | The light palette is not the bare :root | 3 stylesheets |
| SM-83 | medium | UI-04 | page | Theme storage outside try/catch; the OS theme is not read; set after paint | 3 pages |
| SM-84 | medium | UI-19, UI-20 | page | Typing outside a field does not reach the filter; filters have no default item | 4 lists + logline |
| SM-85 | medium | UI-14 | page | A file dropped beside the drop zone opens in the tab and leaves serviceman | 1 page |
| SM-86 | medium | VUE-09 | page | Forms have no <form>: Enter does nothing | 6 forms |
| SM-87 | medium | FN-08 | functions | render_* functions write the HTTP response | 2 functions, 18 callers |
| SM-88 | medium | FN-10, FN-13 | functions | Components load remote data with load/poll, not refresh() | 8 components |
| SM-89 | medium | FILE-21, FILE-18 | files | Modules export one function and hang more public ones on it | 20 values in 17 files |
| SM-90 | medium | FILE-04 | files | The production agent calls main() directly, not cli(main) | 3 executables |
| SM-91 | medium | UI-11, UI-09 | page | Logs jump to the bottom while you read; no test keeps a place | 2 panes |
| SM-92 | low | NAME-04 | names | A lookup that holds one item per key is named in the plural | 192 uses, 2 names |
| SM-93 | low | VAR-14, VAR-15 | names | The start of a measurement is not time0 | ~25 places |
| SM-94 | low | NAME-02 | names | Functions named as past participles read as data | ~25 |
| SM-95 | low | NAME-15, NAME-18 | names | The is_ marker put last | 2 |
| SM-96 | low | NAME-08, NAME-10 | names | Standalone conversions named x_to_y | 3 |
| SM-97 | low | NAME-03, NAME-09 | names | A lookup named _from_, a called _by_ name | 2 (+1 borderline) |
| SM-98 | low | NAME-16 | names | A conversion and the variable it fills do not share a first word | 5 |
| SM-99 | low | NAME-17 | names | The same act named both ways; generic helper names | 12 |
| SM-100 | low | VAR-10 | variables | The for…of variable is not the singular of its collection | ~30 |
| SM-101 | low | VAR-02, VAR-03, VAR-13 | variables | `out` used for what is not the returned result | ~30 |
| SM-102 | low | VAR-01 | variables | Lookup records named without their shape | 9 |
| SM-103 | low | FN-01, FN-02 | functions | Display conversions written by hand, or named *_text | 14 |
| SM-104 | low | CORE-03 | page | An option list uses {value, text} | 6 |
| SM-105 | low | CORE-04 | names | res names a fetch result; start paired with end | 7 |
| SM-106 | low | CORE-02 | names | logline's page is camelCase in a snake_case repo | 120 methods |
| SM-107 | low | FMT-27 | formatting | Operands and ternary conditions are not parenthesized | 920 + 851 lines |
| SM-108 | low | FMT-30 | formatting | A multi-line argument followed by another argument | 124 |
| SM-109 | low | FMT-21, FMT-22, FMT-23, FMT-24 | formatting | Route comments missing, misplaced or misspelled | 17 |
| SM-110 | low | FMT-31 | formatting | Strings joined with + | 15 |
| SM-111 | low | FMT-11, FMT-12, FMT-16, FMT-29 | formatting | Object, method and blank-line shapes | ~35 |
| SM-112 | low | FLOW-11 | flow | A return-only callback written as a function | 14 |
| SM-113 | low | FLOW-02, FLOW-03, FLOW-05, FLOW-08, FLOW-09, FLOW-10 | flow | Loops, chains and load-time side effects | 18 |
| SM-114 | low | FILE-02, FILE-14 | files | Test executables with no main | 4 |
| SM-115 | low | FILE-15, FILE-12, FILE-19 | files | Helpers above the entry; constants among the helpers | 5 files + 7 files |
| SM-116 | low | FILE-20 | files | A file not named after its export; an expression exported | 7 |
| SM-117 | low | VUE-03 | vue | Directive shorthands in every template | 1,163 |
| SM-118 | low | VUE-04 | vue | Attribute order | ~546 elements |
| SM-119 | low | VUE-15 | vue | Lifecycle hooks before computed, watch and methods | ~20 components |
| SM-120 | low | VUE-16, VUE-17, VUE-18 | vue | Click handlers not named after their button | 91 of 94 |
| SM-121 | low | VUE-19, VUE-06 | vue | Empty elements not self-closed; one bare comparison | ~137 + 1 |
| SM-122 | low | VUE-07 | vue | The duration input takes no disabled or readonly, and its label is not linked | 1 component, 10 uses |
| SM-123 | low | CSS-03 | css | Classes with no rule | 9 classes |
| SM-124 | low | CSS-13, CSS-12 | css | No blank line between rules; selector lists on one line | ~600 + 26 |
| SM-125 | low | SQL-01, SQL-03 | sql | Logline's ClickHouse queries are not laid out like code | 6 queries |
| SM-126 | low | PROJ-10, PROJ-11 | layout | Unit tests of one file sit in tests/; modules' tests never run | 6 + 4 |
| SM-127 | low | PROJ-15 | bin | bin scripts lack the template's tempdir and exit message | 11 scripts |
| SM-128 | low | REL-06 | bin | Usage and errors go to stdout | 2 |
| SM-129 | low | PROJ-20, PROJ-23, PROJ-24, PROJ-26, PROJ-27, PROJ-28, PROJ-14 | docs | README: order, quick start, license | 6 rules |
| SM-130 | low | PROJ-13 | docs | Working notes in docs/ | 2 |
| SM-131 | low | LOG-19, LOG-20, LOG-21, LOG-01 | logs | Lists without a count, untrimmed agent lines, shapeless stdout lines | ~8 |
| SM-132 | low | DOC-07 | docs | The last audit note has its sections out of order | 1 |

## Findings

### SM-69 Service env values, secrets included, are written into the logs (high)

Rules: LOG-16. How many: 2 files hold a live secret; every start writes it again.

`src/agent/src/agent_serve.js:320`

```
return {argv: (params.argv === undefined ? '' : params.argv.join(' '))};
```

Should be:

```
log the env names only: --env AUTHWALL_GOOGLE_CLIENT_SECRET=*** (or a reference, not the argv)
```

fed by docker_argv_from_service.js:26 `--env NAME=value`; data/logs/20260831.log and 20260914.log hold the Google OAuth client secret; same full lines at agent_serve.js:335, :338, :341. Prior SM-10, still open.

### SM-70 The compose example mounts /data, but the image keeps its state in /app/data (high)

Rules: PROJ-18, PROJ-19. How many: 3 places.

`examples/docker-compose.yml:33`

```
- data:/data
```

Should be:

```
- data:/app/data
```

Dockerfile:41-44 sets SERVICEMAN_CONFIG/STATE_DIR/LOG_DIR under /app/data, so config, tokens and logs land in the container layer; docker-entrypoint.sh:18 and :23 use /data too; the tailscale state sits outside data/ (docker-entrypoint.sh:38, bin/run:27).

### SM-71 bin/watch starts a file that does not exist; run, build, watch do not wrap npm (high)

Rules: PROJ-03. How many: 3 verbs.

`bin/watch:19`

```
exec npx nodemon --watch src --ext js,json src/main.js "$@"
```

Should be:

```
exec npm run watch  (package.json: "watch": "nodemon … src/main")
```

src/main.js does not exist (src/main/index.js). bin/run:22 and bin/build:15 call docker directly; package.json has only start and test.

### SM-72 A hand-run agent keeps its state beside its own file (medium)

Rules: PROJ-18. How many: 3 leftovers.

`src/agent/src/agent_dir.js:16`

```
return path.dirname(own);
```

Should be:

```
default to data/agent, as bin/serviceman-agent:15 does
```

leftovers: src/agent/doors/table.json, src/agent/status.sock, /app/status.sock.

### SM-73 Command output is logged as bare details and forges tags (medium)

Rules: LOG-17. How many: 13,797 lines in one day; 4 call sites.

`src/agent/src/agent_serve.js:266`

```
agent_say(call, (stream === 'stdout' ? 'agent_call_stdout' : 'agent_call_stderr'), text, params.service);
```

Should be:

```
line="…" — JSON-quoted unless a bare word
```

a real line: [agent_call_stdout] [cmg8…][+0.0035s][req_uid] req_…; also agent_program_follow.js:104, handle_request.js:123 (raw req.url), agent_serve.js:280 (raw error text).

### SM-74 Begins and ends that do not pair (medium)

Rules: LOG-10, LOG-06, LOG-14. How many: 9 senders.

`src/main/src/helpers/load_test_run.js:63`

```
log_event(app, 'load_test_start', …)  …  'load_test_end'
```

Should be:

```
load_test_begin … load_test_end
```

door_upgrade_begin has no end (agent_door_answer.js:54); agent_link_end has no begin (src/agent/index.js:188); http_socket_begin never closed (3,597 open); agent_serve.js:282 a slow quiet call ends with no spawn or begin.

### SM-75 One sender name written from several call sites (medium)

Rules: LOG-08. How many: 18 senders.

`src/main/src/routes/handle_control_upgrade.js:96`

```
log_event(app, 'shell_begin', …)   (also :125, :164, :167)
```

Should be:

```
one distinct sender per call site
```

program_step_begin, program_step_end_error, docker_run/docker_start/docker_recreate (docker_start.js and program_docker_start.js), door_request_refused, upstream_error, remote_update_refused …

### SM-76 A call to an agent does not carry the caller's group, so the trace breaks at the link (medium)

Rules: LOG-07. How many: 1 place, every remote call.

`src/main/src/helpers/remote_call.js:16`

```
link_send_message(state.socket, {type: 'call', id, method, params: …});
```

Should be:

```
{type: 'call', id, method, group, params}  → parent=group on the agent
```

the agent makes the call a child of the link group (agent_serve.js:258).

### SM-77 Lines on stdout carry the time even under docker (medium)

Rules: LOG-04. How many: 2 places.

`src/agent/src/agent_say.js:79`

```
console.log(line);
```

Should be:

```
ENV SERVICEMAN_LOG_TIME=off in both images, and the same switch for the agent
```

Dockerfile:41-44 does not set it; log_stdout_time_from_env.js:5 defaults to on.

### SM-78 The release writes the agent bundle into a committed file at the root (medium)

Rules: PROJ-04, REL-01, REL-02. How many: 1 pipeline.

`bin/release:40-42`

```
bin/agent-bundle
git add package.json serviceman-agent.js
```

Should be:

```
build/serviceman-agent.js, then rm -rf dist && cp -r build dist; git add dist
```

src/agent/bin/build:10 DEFAULT_PATH is the root; no build/ or dist/; .gitignore lacks build/.

### SM-79 config/index.js reads no environment; the env is read all over (medium)

Rules: PROJ-07. How many: 4+ places.

`config/index.js:5`

```
module.exports = {listen: {host: '127.0.0.1', …
```

Should be:

```
module.exports = make_config(process.env)
```

src/main/index.js:66, :67, :115; app_from_config.js:25; logline_admin_call.js:28; the agent in ~15 files (borderline, it is bundled).

### SM-80 "Are you sure?" steps, and no Undo anywhere (medium)

Rules: UI-15, UI-16. How many: 11 dialogs.

`src/main/public/load_tests_pane.js:360`

```
if (window.confirm(`Remove the load test ${test.name}? …`) === false) {
```

Should be:

```
remove at once; a toast "Removed · Undo", or a trash
```

remote_form.js:61-65, service_form.js:490-493, secrets_form.js:20-26 and :55-58, docker.js:74-77, :103-106, :137-140, :166-169, :192-195, file_manager.js:114-116.

### SM-81 The theme switch does not show the current theme (medium)

Rules: UI-02. How many: 4 pages.

`src/main/public/serviceman.js:2649`

```
<button type="button" id="theme" title="Light or dark" @click="theme_toggle">  (one fixed sun)
```

Should be:

```
sun in Light, crescent in Dark (img/theme-sun.svg, theme-moon.svg)
```

examples/terminal-web/index.html:106; web_terminal.js:20 (text); logline/log-ui/index.html:82-88 (☾ ☀ glyphs).

### SM-82 The light palette is not the bare :root (medium)

Rules: UI-03. How many: 3 stylesheets.

`src/main/public/serviceman.css:4`

```
:root[data-theme="light"] {
```

Should be:

```
:root {   … and :root[data-theme="dark"] { for dark
```

web_terminal.css:2; logline/log-ui/styles.css:1 has it inverted (dark in :root).

### SM-83 Theme storage outside try/catch; the OS theme is not read; set after paint (medium)

Rules: UI-04. How many: 3 pages.

`src/main/public/index.html:14`

```
document.documentElement.dataset.theme = (localStorage.getItem('serviceman.theme') || …
```

Should be:

```
try { … } catch { … }, and prefers-color-scheme when nothing is saved
```

prior SM-38 still open; serviceman.js:3523, :2770; examples/terminal-web/index.html:362 and :134 (after first paint).

### SM-84 Typing outside a field does not reach the filter; filters have no default item (medium)

Rules: UI-19, UI-20. How many: 4 lists + logline.

`src/main/public/serviceman.js:3341`

```
if (event.key === '/' && typing === false && …) {
```

Should be:

```
any printable key focuses the pane's filter; Enter opens the first match
```

services_pane.js:17, remotes_pane.js:20, addresses_pane.js:18, volumes_pane.js:13; logline/log-ui/app.js:1694. The Ctrl K palette does it right.

### SM-85 A file dropped beside the drop zone opens in the tab and leaves serviceman (medium)

Rules: UI-14. How many: 1 page.

`src/main/public/serviceman.js:3606`

```
addEventListener('dragstart', …)   (dragover/drop not cancelled)
```

Should be:

```
window dragover/drop → preventDefault, outside the File Manager list
```

only file_manager.js:184 handles a drop.

### SM-86 Forms have no <form>: Enter does nothing (medium)

Rules: VUE-09. How many: 6 forms.

`src/main/public/remote_form.js:74`

```
<button type="button" class="primary" :disabled="busy" @click="save">Save</button>
```

Should be:

```
<form v-on:submit.prevent="click_save"> … <button type="submit">
```

join_form.js:53, secrets_form.js:41, load_tests_pane.js:62, service_form.js:479 and :499. Only logline's range form is right.

### SM-87 render_* functions write the HTTP response (medium)

Rules: FN-08. How many: 2 functions, 18 callers.

`src/main/src/helpers/render_error_page.js:65`

```
res.writeHead(status, {…}); res.end(html);
```

Should be:

```
render_error_page(…) returns html; error_page_send(res, …) writes it
```

render_waiting_page.js:82-87 the same.

### SM-88 Components load remote data with load/poll, not refresh() (medium)

Rules: FN-10, FN-13. How many: 8 components.

`src/main/public/volumes_pane.js:102`

```
load: async function () {
```

Should be:

```
refresh: async function () {   (created calls the first refresh)
```

secrets_form.js:84, serviceman.js:3205 poll, remote_shell.js terminals_load, remotes_pane.js:172, find_palette.js:213, docker.js:495, web_terminal.js:52.

### SM-89 Modules export one function and hang more public ones on it (medium)

Rules: FILE-21, FILE-18. How many: 20 values in 17 files.

`src/agent/src/agent_wall_ask.js:48`

```
agent_wall_ask.own = function (url) {
```

Should be:

```
agent_wall_ask_own.js, a module of its own
```

agent_tunnel.js:168, wall_ask.js:32/38, logline_tell.js:76, agent_http_serve.js:90/105, agent_say.js:31, agent_apt.js:114, program_kill.js:71 …

### SM-90 The production agent calls main() directly, not cli(main) (medium)

Rules: FILE-04. How many: 3 executables.

`src/agent/index.js:93`

```
main();
```

Should be:

```
cli(main);
```

tests/fixtures/upstream.js:6, tests/bin/docker:9.

### SM-91 Logs jump to the bottom while you read; no test keeps a place (medium)

Rules: UI-11, UI-09. How many: 2 panes.

`src/main/public/serviceman.js:850-855`

```
pane.scrollTop = pane.scrollHeight;   (on every poll)
```

Should be:

```
follow only when the view is already at the end
```

docker.js:561-566; no test covers keeping the place.

### SM-92 A lookup that holds one item per key is named in the plural (low)

Rules: NAME-04. How many: 192 uses, 2 names.

`src/main/src/helpers/app_from_config.js:45`

```
out.remotes_by_name[remote.name] = remote;
```

Should be:

```
remote_by_name, service_by_name
```

remotes_by_name 110 places, services_by_name 82, in 28 files.

### SM-93 The start of a measurement is not time0 (low)

Rules: VAR-14, VAR-15. How many: ~25 places.

`src/main/src/helpers/image_pull.js:20`

```
const at = Date.now();
```

Should be:

```
const time0 = Date.now();
```

began (wait_http_answer.js:38), started (lines_serve.js:89), asked_at, opened_at, ping_at …

### SM-94 Functions named as past participles read as data (low)

Rules: NAME-02. How many: ~25.

`src/main/src/helpers/instance_stopped.js:4`

```
function instance_stopped(instance)   (it changes the instance)
```

Should be:

```
function instance_mark_stopped(instance)
```

home_expanded, headers_forwarded, asset_stamped, url_logged …; predicates without is_: alive(pid), full(spool), big_enough.

### SM-95 The is_ marker put last (low)

Rules: NAME-15, NAME-18. How many: 2.

`src/main/src/helpers/localhost_url_is.js:3`

```
function localhost_url_is(url)
```

Should be:

```
function is_localhost_url(url)
```

docker_serve.js:256 helper_is.

### SM-96 Standalone conversions named x_to_y (low)

Rules: NAME-08, NAME-10. How many: 3.

`src/main/public/service_form.js:1390`

```
function service_to_json(model)
```

Should be:

```
function json_from_service(model)
```

remote_form.js:197, join_form.js:129.

### SM-97 A lookup named _from_, a called _by_ name (low)

Rules: NAME-03, NAME-09. How many: 2 (+1 borderline).

`src/main/src/routes/handle_remote_upgrade.js:83`

```
function remote_by_token(app, header)
```

Should be:

```
function remote_find_by_token(app, header)
```

remote_from_instance.js:5 only looks up.

### SM-98 A conversion and the variable it fills do not share a first word (low)

Rules: NAME-16. How many: 5.

`src/agent/src/agent_package_list.js:20`

```
const items = package_list_from_dpkg(…)
```

Should be:

```
const package_list = package_list_from_dpkg(…)
```

service_form.js:541, :927; agent_updates.js:25.

### SM-99 The same act named both ways; generic helper names (low)

Rules: NAME-17. How many: 12.

`tests/fake_docker_engine.js:163`

```
json_send   (vs send_json in 176 calls)
```

Should be:

```
one spelling: send_json
```

send_file vs file_send; logline_spool.js append/flush/close → spool_*; upload_queue.js take/copy/stop/clear.

### SM-100 The for…of variable is not the singular of its collection (low)

Rules: VAR-10. How many: ~30.

`src/main/src/helpers/app_apply_config.js:38`

```
for (const item of config.services) {
```

Should be:

```
for (const service of config.services) {
```

serviceman.js:1019 kid of children; agent_program_follow.js:30 read of readers …

### SM-101 `out` used for what is not the returned result (low)

Rules: VAR-02, VAR-03, VAR-13. How many: ~30.

`src/agent/src/agent_door_proxy.js:15`

```
const out = http.request(…)
```

Should be:

```
const upstream = http.request(…)
```

out passed on (load_test_run.js:78, serviceman.js:1011); joined on the way out (log_words.js:22 return out.join(' ') → words).

### SM-102 Lookup records named without their shape (low)

Rules: VAR-01. How many: 9.

`src/main/public/serviceman.js:985`

```
const by_pid = {};
```

Should be:

```
const proc_by_pid = {};
```

kids, by_key, by_project, layers, routes_exact, calls, streams …

### SM-103 Display conversions written by hand, or named *_text (low)

Rules: FN-01, FN-02. How many: 14.

`src/agent/src/agent_door_answer.js:28`

```
took: `${((Date.now() - at)/1000).toFixed(3)}s`
```

Should be:

```
took: format_seconds(Date.now() - time0)
```

lines_serve.js:106, src/main/index.js:215/228 …; bytes_text duplicates format_bytes; age_text, thousands_text, ports_text.

### SM-104 An option list uses {value, text} (low)

Rules: CORE-03. How many: 6.

`src/main/public/service_form.js:651`

```
out.push({value: item.name, text: this.remote_text(item)});
```

Should be:

```
out.push({value: item.name, label: this.remote_text(item)});
```

service_form.js:7 KINDS as bare strings + KIND_NAMES; networking_pane.js:62/67/71, service_doors.js:53 raw records.

### SM-105 res names a fetch result; start paired with end (low)

Rules: CORE-04. How many: 7.

`src/agent/src/logline_ship.js:110`

```
res = await fetch(…)
```

Should be:

```
response = await fetch(…)
```

container_disk.js:121/302/333, logline_follow.js:31; file_manager.js:65 edit_start/edit_end → edit_begin.

### SM-106 logline's page is camelCase in a snake_case repo (low)

Rules: CORE-02. How many: 120 methods.

`logline/log-ui/app.js:244`

```
formattedEventCount: function () {
```

Should be:

```
formatted_event_count: function () {
```

refreshLabels, formatCount, queryStatus … (logline is moving to its own repo)

### SM-107 Operands and ternary conditions are not parenthesized (low)

Rules: FMT-27. How many: 920 + 851 lines.

`src/main/src/helpers/pool_autoscale.js:36`

```
if (state.scaled_at !== null && now - state.scaled_at < policy.cool_down_ms) {
```

Should be:

```
if ((state.scaled_at !== null) && (now - state.scaled_at < policy.cool_down_ms)) {
```

hotspots: serviceman.js 177, handle_control_request.js 147, service_form.js 106, docker_serve.js 71. Only k6_script.js:30 follows it.

### SM-108 A multi-line argument followed by another argument (low)

Rules: FMT-30. How many: 124.

`src/main/index.js:84-86`

```
setInterval(function () {
    …
}, REAP_INTERVAL_MS);
```

Should be:

```
function reap() {…}
setInterval(reap, REAP_INTERVAL_MS);
```

handle_control_request.js:1107 (+6), .then(fn, fn) in 3 places, chained calls after a multi-line argument x5.

### SM-109 Route comments missing, misplaced or misspelled (low)

Rules: FMT-21, FMT-22, FMT-23, FMT-24. How many: 17.

`src/main/src/routes/handle_control_request.js:718`

```
async function handle_screenshot(app, res, name)   (its comment is stranded at :683)
```

Should be:

```
// POST /api/v1/remotes/<name>/screenshot
// <intent>
async function handle_screenshot(…)
```

docker_serve.js: 8 route functions without (borderline); examples/terminal-web/server.js:86-89 query in the path; :910-914 intent before the route line.

### SM-110 Strings joined with + (low)

Rules: FMT-31. How many: 15.

`src/agent/src/agent_update.js:113`

```
' — it said: ' + said
```

Should be:

```
` — it said: ${said}`
```

service_form.js:674, serviceman.js:1932, find_palette.js:109 …

### SM-111 Object, method and blank-line shapes (low)

Rules: FMT-11, FMT-12, FMT-16, FMT-29. How many: ~35.

`src/main/public/serviceman.js:499`

```
'view.name'() {
```

Should be:

```
'view.name': function () {
```

FMT-11 several fields on one line of a multi-line object (~30, mostly tests); FMT-29 two blank lines handle_control_request.js:750, :908.

### SM-112 A return-only callback written as a function (low)

Rules: FLOW-11. How many: 14.

`src/main/src/helpers/config_remote_add.js:11`

```
return config_locked(app, function () {
    return remote_write(app, remote);
});
```

Should be:

```
return config_locked(app, () => remote_write(app, remote));
```

html_escape.js:6, instance_start.js:23 …

### SM-113 Loops, chains and load-time side effects (low)

Rules: FLOW-02, FLOW-03, FLOW-05, FLOW-08, FLOW-09, FLOW-10. How many: 18.

`src/agent/src/agent_logline.js:32`

```
agent_say.sink_set(function (time, tail) {   (runs at require time)
```

Should be:

```
set the sink in agent_logline_start(), called by main
```

FLOW-03 entries() loops in log-ui/app.js x6; FLOW-05 multi-line chains x3; FLOW-09 Object.create(scope); FLOW-08 unused catch (error) x3; FLOW-02 shot.js:55.

### SM-114 Test executables with no main (low)

Rules: FILE-02, FILE-14. How many: 4.

`tests/fixtures/app_server.js:6`

```
http.createServer(function (req, res) {   (top level)
```

Should be:

```
cli(main);

function main() {…}
```

shot.js:9, ws_echo_server.js:12, tests/bin/apt-get.

### SM-115 Helpers above the entry; constants among the helpers (low)

Rules: FILE-15, FILE-12, FILE-19. How many: 5 files + 7 files.

`src/main/index.js:233`

```
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGUSR2'];   (after cli(main) and 10 helpers)
```

Should be:

```
with the other constants at :31-48
```

program_docker_argv.js:16, image_prepull_start.js:15, handle_request.js:35 …; serviceman.js has 15 constants and createApp mid-file.

### SM-116 A file not named after its export; an expression exported (low)

Rules: FILE-20. How many: 7.

`src/agent/src/agent_apt.js:116`

```
module.exports = agent_apt_upgrade;
```

Should be:

```
agent_apt_upgrade.js, or export agent_apt
```

k6_lane.js:3 module.exports = '#k6:'; agent_term_holder_py.js:110 …

### SM-117 Directive shorthands in every template (low)

Rules: VUE-03. How many: 1,163.

`src/main/public/addresses_pane.js:20`

```
<button v-for="chip of chips" :key="chip.value" … @click="show = chip.value">
```

Should be:

```
<button v-for="chip of chips" v-on:click="…" v-bind:key="chip.value" …>
```

the lint checks only .vue files; serviceman writes templates as strings. 429 @, 734 : in 26 files.

### SM-118 Attribute order (low)

Rules: VUE-04. How many: ~546 elements.

`src/main/public/serviceman.js:2649`

```
<button type="button" id="theme" title="…" @click="theme_toggle">
```

Should be:

```
<button v-on:click="…" type="button" id="theme" title="…">
```

### SM-119 Lifecycle hooks before computed, watch and methods (low)

Rules: VUE-15. How many: ~20 components.

`src/main/public/find_palette.js:54`

```
created: … mounted: … watch: …   (before computed :77, methods :163)
```

Should be:

```
data computed watch methods mounted created
```

service_form.js:514, map_pane.js:113, docker.js:246, command_copy.js, terminal.js …

### SM-120 Click handlers not named after their button (low)

Rules: VUE-16, VUE-17, VUE-18. How many: 91 of 94.

`src/main/public/remote_form.js:64`

```
<button … @click="remove">Forget it</button>
```

Should be:

```
<button v-on:click="click_forget_it">Forget it</button>
```

secrets_form.js:41 save on "Keep it"; icon buttons named by action (theme_toggle).

### SM-121 Empty elements not self-closed; one bare comparison (low)

Rules: VUE-19, VUE-06. How many: ~137 + 1.

`src/main/public/serviceman.js:2035`

```
<span v-if="dir_error(dir.path) !== null" class="bad">
```

Should be:

```
<span v-if="(dir_error(dir.path) !== null)" class="bad">
```

VUE-19: authwall_pane.js:54 <th></th>, join_form.js:24 <input …> (118 void elements).

### SM-122 The duration input takes no disabled or readonly, and its label is not linked (low)

Rules: VUE-07. How many: 1 component, 10 uses.

`src/main/public/service_form.js:423-424`

```
<label>Start timeout</label>
<div><duration v-model="m.start_timeout" placeholder="120s"/></div>
```

Should be:

```
<label v-bind:for="id">… <duration v-bind:id="id" …>
```

### SM-123 Classes with no rule (low)

Rules: CSS-03. How many: 9 classes.

`src/main/public/authwall_pane.js:17`

```
<div class="row-of svc-state">
```

Should be:

```
drop svc-state, or give it its rule
```

svc, procs-pane, ports-pane, map-pane, map-key run, terms-field, size (docker), dot.stopped, ov-aside.

### SM-124 No blank line between rules; selector lists on one line (low)

Rules: CSS-13, CSS-12. How many: ~600 + 26.

`src/main/public/serviceman.css:28-29`

```
}
* {
```

Should be:

```
}

* {
```

serviceman.css 369 of 386 rules; logline styles.css 201; selector lists in logline, web-terminal, terminal-web.

### SM-125 Logline's ClickHouse queries are not laid out like code (low)

Rules: SQL-01, SQL-03. How many: 6 queries.

`logline/log-ui/app.js:891-894`

```
FROM default.otel_logs
WHERE ${where}
```

Should be:

```
FROM
    default.otel_logs
WHERE
    ${where}
```

and the query body is not indented under `const sql`.

### SM-126 Unit tests of one file sit in tests/; modules' tests never run (low)

Rules: PROJ-10, PROJ-11. How many: 6 + 4.

`tests/agent_cpu_busy.test.js`

```
tests/agent_cpu_busy.test.js   (tests src/agent/src/agent_cpu_busy.js)
```

Should be:

```
src/agent/src/agent_cpu_busy.test.js
```

modules/*/tests/*.test.js (4 files) are not matched by npm test.

### SM-127 bin scripts lack the template's tempdir and exit message (low)

Rules: PROJ-15. How many: 11 scripts.

`bin/build`

```
set -o nounset -o errexit -o pipefail … docker build …
```

Should be:

```
bin/templ: mktemp -d + EXIT trap + coloured exit message
```

logline/lines/bin/run and test are #!/bin/sh.

### SM-128 Usage and errors go to stdout (low)

Rules: REL-06. How many: 2.

`bin/release:24`

```
echo usage: release 'major|minor|patch' 2>&1
```

Should be:

```
echo usage: release 'major|minor|patch' >&2
```

:30 the same.

### SM-129 README: order, quick start, license (low)

Rules: PROJ-20, PROJ-23, PROJ-24, PROJ-26, PROJ-27, PROJ-28, PROJ-14. How many: 6 rules.

`README.md:24-28`

```
bin/configure
bin/run serviceman.json   (ignored argument; ports 8080/8081 while bin/run publishes 3000/3001)
```

Should be:

```
bin/configure
bin/build
bin/run
```

heading before the cover; four-sentence intro; ## Docs without the full-documentation link; no LICENSE or ## License.

### SM-130 Working notes in docs/ (low)

Rules: PROJ-13. How many: 2.

`docs/agent-live-upgrade.md:88`

```
--- claude ---
```

Should be:

```
move to notes/
```

docs/orphans.md:3 "Not built. Written down while it was fresh".

### SM-131 Lists without a count, untrimmed agent lines, shapeless stdout lines (low)

Rules: LOG-19, LOG-20, LOG-21, LOG-01. How many: ~8.

`src/main/src/helpers/remote_attach.js:146`

```
tags: remote_tags(remote)   → tags=[]
```

Should be:

```
tags=0:[]
```

agent_say.js:75-78 no 2000-byte cap; docker-entrypoint.sh:32 echo "serviceman: …".

### SM-132 The last audit note has its sections out of order (low)

Rules: DOC-07. How many: 1.

`notes/audit-2026-09-24.md:1205`

```
## 9. Status of prior findings   (before What is good)
```

Should be:

```
findings, what is good, order of work, status of prior findings, inventory
```

## What is good

- Every one of the 352,000+ lines in `data/logs/2026*.log` has the `[time][group][sender] details` shape; all 127 senders are snake_case; requests and connections end with their status and duration.
- One exported function per file in `src/helpers`, the export last; requires sorted; arrows on one line; `for…of` everywhere (lint-clean apart from the documented transitions).
- Option lists are `{value, label}` almost everywhere; every SVG icon uses currentColor; tabular data are tables; headers never scroll away.
- logline's "load older" keeps the reader's place; the Ctrl K palette has a default item and opens it on Enter.

## Recommended order of work

1. **SM-69** today: stop logging env values, delete the two log files' secret lines, and rotate the Google OAuth client secret (logline may have shipped the lines too).
2. **SM-70, SM-71, SM-72**: the compose volume, bin/watch, the hand-run agent's state folder: each breaks something a user does.
3. The page: SM-80 (no confirmation dialogs, Undo instead), SM-81–83 (theme switch and palette), SM-84–85 (typing reaches the filter, drop guard), SM-86 (forms submit on Enter), SM-91 (logs that stay put while read).
4. Logs: SM-73–77, so a trace from a request reaches the docker run on the machine.
5. Code shape (SM-87–90), then renames and formatting (SM-92 on): mechanical, best done file by file, with the lint taught to check the template strings where it can.

## Status of prior findings

- SM-10 (secrets in logs): **still open**, now SM-69.
- SM-38 (blocked localStorage blanks the page): **still open**, part of SM-83.
- The rest of `notes/audit-2026-09-24.md` was not re-checked in this audit.
