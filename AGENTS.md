# serviceman

serviceman answers on the hostnames it is given, starts a service (a docker image or a
program, here or on a machine whose agent dialled in) on the first request, and stops it when
nobody visits. What it is and how it works: [README.md](README.md) and [docs/](docs/).

## The project

- **Server:** Node, CommonJS, in `src/main` (`src/main/index.js`); its config is `config/index.js`.
- **Agent:** `src/agent`, bundled into one file with no dependencies (`bin/agent-bundle`); it
  runs on the machines and dials serviceman. "ServiceMan agent" is this program; a "coding
  agent" is an AI agent like you.
- **Page:** Vue 3, options API, templates as strings, ES modules served as they are from
  `src/main/public` and `modules/*/ui`, with no build step; `bin/vendor` copies the libraries
  into `src/main/public/vendor`.
- **Modules:** `modules/docker`, `file_manager`, `firewall`, `terminal`, `volumes`, each with
  `server/`, `ui/` and `tests/`.
- **Logline:** `logline/` (its server in `logline/lines`, its page in `logline/log-ui`) is
  self-contained and is moving to a repository of its own; keep it free of serviceman's code.
- **web-terminal:** a page and a server of its own, in `src/web-terminal/`.
- **Notes and audits:** working notes in `notes/`; a full audit is `notes/audit-<date>.md`,
  and its register is the issue list (the last id is SM-132).

## Commands

    bin/configure                       # after a fresh checkout or a pull
    bin/run                             # the image, with data/serviceman.json; the page is http://serviceman.localhost:3001
    bin/test                            # the suites in tests/ (npm test)
    node --test modules/*/tests/*.test.js
    (cd logline/lines && bin/test)
    npm run lint                        # the rulebook's linter, see below
    bin/build                           # the docker image the author runs
    bin/agent-version patch|minor       # after any change to the agent
    bin/release major|minor|patch

`bin/watch` starts `src/main.js`, which does not exist (SM-71): run `bin/run` instead.

## Local rules

- **The agent's version.** Every change to `src/agent/**`, or to a `src/helpers` file the
  agent bundles, raises `src/agent/version.json` in the same change: `bin/agent-version patch`
  for a fix, `minor` for something new. A major version is the author's alone.
  `tests/agent_version.test.js` fails until it is done.
- **A restart of the agent touches nothing it started:** containers, programs and kept
  terminals go on running.
- **The running serviceman is the docker image.** A change shows only after `bin/build` and a
  restart; say so when handing a change over.
- **Plain CSS.** `src/main/public/serviceman.css`, `logline/log-ui/styles.css` and
  `src/web-terminal/public/web_terminal.css` are served as they are, with no preprocessor for
  `@include app-transition`: their transitions are written by hand, and the linter's 24
  CSS-09 findings on them are expected.
- **Nothing private in the repository: it is public.** Secrets and tokens, the names and
  addresses of real machines, people's names, e-mails and home paths, real logs and dumps never
  go into a file git tracks. They live outside the repository: in `data/` (the state dir,
  `SERVICEMAN_STATE_DIR`), in `.env` or in the local `serviceman.json`, all in `.gitignore`.
  A file that needs such a value takes a placeholder: `example.com`, `user@example.com`,
  `/home/user`, `192.0.2.x`, `100.64.0.20` for a tailnet address, `tail1234.ts.net`; machines
  are `laptop`, `desktop`, `phone`, `server`, `vps1`, `vps2`. Before handing a change over,
  grep it for all of these kinds and for your own machine names.

<!-- rules: begin, from https://github.com/vbarbarosh/rules at 6435a76892143781b644ef8e22608c603992c874, 2026-10-10 -->

## The rules

Every file here follows the rulebook,
[vbarbarosh/rules](https://github.com/vbarbarosh/rules) at
[6435a76](https://github.com/vbarbarosh/rules/tree/6435a76892143781b644ef8e22608c603992c874):
[the rule index](https://github.com/vbarbarosh/rules/blob/6435a76892143781b644ef8e22608c603992c874/docs/rules.md)
and [FORMATTING.md](https://github.com/vbarbarosh/rules/blob/6435a76892143781b644ef8e22608c603992c874/FORMATTING.md).
Read the rules that touch your change before you make it.

### Rule groups

Apply:

- **CORE, NAME, VAR, FN, FMT, FLOW** to all JavaScript: the server, the agent, the modules, Logline, web-terminal, the page and the tests.
- **FILE**, except FILE-17 (the rulebook's own module format). Module format is this project's choice (LINT-07): Node code is CommonJS; the page and `modules/*/ui` are ES modules.
- **PROJ** to the layout, `bin/`, `data/`, `config/`, `docs/`, `notes/`, `img/`, `demos/` and README.md.
- **REL-02 to REL-06** to `bin/release`.
- **GIT** to every commit.
- **LOG** to serviceman's, the agent's and Logline's logs; [docs/logs.md](docs/logs.md) describes them.
- **CSS** to the pages' styles, except CSS-09 in the three plain stylesheets (Local rules above).
- **SQL** to Logline's queries. They are ClickHouse, not MySQL: the layout rules hold, and a function keeps its own case (`toStartOfInterval`), since ClickHouse function names are case sensitive.
- **UI, UIM** to every page: serviceman's, Logline's, web-terminal's.
- **VUE-05, VUE-06, VUE-15 to VUE-18** to the page's components.
- **DOC-06 to DOC-10, DOC-12** to `notes/audit-<date>.md` and the documents in `docs/`.
- **LINT** to every file the linter reads.

Do not apply:

- **REL-01:** serviceman ships a docker image and a bundled agent, not a prebuilt `dist/`.
- **VUE-01, VUE-02, VUE-07 to VUE-14:** they describe Vue 2 components this page does not have (the mixin globals, app-form inputs, vue-modal, svg-icon files).
- **DOC-01 to DOC-05, DOC-11, DOC-13:** they are about the rulebook's own documents.
- **Open, the author's decision:** VUE-03, VUE-04 and VUE-19 are written for Vue 2 templates; whether they bind this page's Vue 3 string templates is not decided. Until it is, a template matches the templates around it (shorthand `@` and `:`).

### Lint

    npm run lint

It runs `npx vbarbarosh/rules src tests modules logline/lines logline/log-ui config demos`. Judge it by its exit status and read every finding. Today it reports only CSS-09 on the three plain stylesheets; anything else is new and is fixed. The linter does not read Vue template strings: check those by eye.

## Agent guides

The guides from [agents/](https://github.com/vbarbarosh/rules/tree/6435a76892143781b644ef8e22608c603992c874/agents), word for word.

### Consequences first

A developer given a task does not start typing. They first picture what the
change leads to: what if this, what if that. Only then do they start, and the
work follows from that picture. An agent works the same way.

#### Why

An agent that starts at once changes exactly what was named and stops there.
Whatever follows from the change is left for the author to find: the other
cases built the same way, the states that break the layout, the decision that
needed asking. Thinking first takes a minute. Without it, each consequence
costs the author a message, found one at a time.

#### The rule

1. **Before the first edit, ask "what if".** What else is built like this?
   What does the change touch, slow down, leave stale or break? What happens
   when the data is long, empty, absurd? What does the author not see from
   where they stand?
2. **Let the answers shape the work.** They decide the scope (see
   [One example, all cases](https://github.com/vbarbarosh/rules/blob/6435a76892143781b644ef8e22608c603992c874/agents/one_example_all_cases.md)), the states to
   test (see [Every state before done](https://github.com/vbarbarosh/rules/blob/6435a76892143781b644ef8e22608c603992c874/agents/every_state_before_done.md)) and the
   stories to tell (see [Every point of view](https://github.com/vbarbarosh/rules/blob/6435a76892143781b644ef8e22608c603992c874/agents/every_point_of_view.md)).
3. **Tell the author what was found.** A consequence that makes the change a
   poor one is said before the change, with the better way. What was decided
   along the way is said for information. What is truly ambiguous is asked,
   once, with the options.

### One example, all cases

The author shows one case and means all cases like it. A request that points
at a dropdown, a button or a query names a kind of thing through one
instance of it. The agent's job is to find the rest of that kind, not to fix
the one instance and stop.

This page is meant to be handed to an agent as it is: "work like this".
It is one case of [Consequences first](https://github.com/vbarbarosh/rules/blob/6435a76892143781b644ef8e22608c603992c874/agents/consequences_first.md).

#### Why

The author sees one case because that is the one in front of them. The
project holds the other hundred, built the same way, with the same flaw.
Fixing only the shown one leaves the project inconsistent: one dropdown is
fast and the rest lag, one button has the new font and the rest the old.
Then the author has to find each remaining case and point at it, one message
each. Finding every case of a pattern is the work a machine does better than
a person; leaving it to the author leaves the agent's work to them.

A change also has consequences the author may not have weighed. A cache
serves stale data after an edit; a moved button may now cover another one or
leave a gap. The author would rather hear that before the change than
discover it after.

#### The rule

1. **An example names a class.** Unless the author says the change is for
   this one case only, it applies to every case like it. "Change the font of
   these buttons" means every button. "Cache this list" means every list
   loaded the same way.
2. **Find the like cases before changing anything.** Search the project for
   the same pattern: the same component, the same kind of request, the same
   style, the same idiom. The example is the way in, not the boundary.
3. **Change them all, or say which stay.** The change goes to every case
   found. A case left as it was is named in the reply, with the reason; none
   is left out silently.
4. **Ask when the sweep is large or the class unclear.** When the like cases
   are many across a big project, or the example could belong to more than
   one class, ask one question that carries what was found: "only this
   dropdown, or all 37 lists that load on open?". Asking to clarify scope is
   expected, not a failure.
5. **Say what the change will cause.** Before making it, name the
   consequences seen: what else moves, breaks or goes stale, and what it
   costs. When a consequence makes the change a poor one, say so first and
   offer the better way; the author decides.

### Every state before done

A piece of UI is not done when it looks right with the one text it was built
with. It is done when it holds with every text and value it will be given.
The agent tries those before saying "done", not the author after.
It is one case of [Consequences first](https://github.com/vbarbarosh/rules/blob/6435a76892143781b644ef8e22608c603992c874/agents/consequences_first.md).

![the close button pushed under a long alert message](https://raw.githubusercontent.com/vbarbarosh/rules/6435a76892143781b644ef8e22608c603992c874/agents/every-state-alert.png)

The alert above was built with a short message. A long one took the whole
row, and the close button wrapped to a line of its own, under the text. One
long message in a test would have shown it.

#### Why

The author sees the UI with real data, and real data is never the sample
the agent typed: a name is long, a title is missing, a count is zero or a
million. Each of those breaks a layout made for the sample, and each break
costs the author a screenshot and a message. Trying the states takes the
agent minutes; finding them one by one takes the author days.

#### The rule

1. **List the states before calling it done.** For every text and value the
   element shows:
   - too long: a title of three lines, a word with no spaces, a path, a URL;
   - missing: empty, `null`, no title at all;
   - tiny: one letter, one item;
   - absurd: zero, negative, a million, a date years away;
   - and the element's own states: loading, error, disabled, many at once.
2. **Render each one and look.** A screenshot of each state, or one page
   with all of them side by side. A state that was not rendered was not
   tested.
3. **Make the layout hold them.** Fixed parts keep their place: a close
   button stays top right however long the text, a long text wraps or
   ellipsizes inside its own column, an empty one collapses or shows a
   placeholder. Nothing overlaps, nothing is pushed out of view, nothing
   shows through from behind.
4. **Keep the states in a test.** The crowded case goes into the e2e test,
   with an assertion that nothing overlaps, so the next change does not
   break it again unseen.
5. **Report what each state led to.** The reply names the states rendered,
   with the screenshots, and sorts them in two:
   - **Decided, for your information.** A state with a clear answer is
     handled and said: "a title longer than the row is cut with an ellipsis;
     the full one is in the tooltip".
   - **Ambiguous, needs your confirmation.** A state with no clear answer is
     not guessed at quietly. It is put to the author as one question with
     the options: "an empty title: hide the header, or show 'Untitled'?".

### Every point of view

One task is several stories told side by side: how the user uses it, how it
is built, how someone would break it. An agent tells each story before
calling the work done, and the screen follows the user's story, whatever the
implementation does inside.

It is one case of [Consequences first](https://github.com/vbarbarosh/rules/blob/6435a76892143781b644ef8e22608c603992c874/agents/consequences_first.md).

![Send is pressed: on the left the comment is nowhere for 2 seconds, then it shows; on the right it shows at once marked Sending, and the mark goes when the server has it](https://raw.githubusercontent.com/vbarbarosh/rules/6435a76892143781b644ef8e22608c603992c874/drafts/optimistic-updates.gif)

Above, a comment sent under a task. In the implementation's story it goes
to the server, waits until it is filed, and comes back with the next
refresh, and that story is right. In the user's story they answered under
this task, and for two seconds the answer is nowhere. Both stories describe
the same click; only one was told while building it.

#### Why

An agent builds from the implementation's story, because that is the one it
writes: files, queues, requests. The user lives in another story, of what
they did and what they see, and the attacker in a third, of what they can
reach. A defect in one story is invisible from the others: a correct queue
is a missing message on screen; a convenient endpoint is an open door. The
author finds each one by living that story, one message each.

#### The points of view

Told by the author:

- **User.** What I do, what I see, what I expect next. The screen answers
  my action at once, where I acted; the route inside is not my business.
- **Implementation.** How it works: where data goes, in what order, what
  waits for what, what happens when a step fails.
- **Attacker.** What I can reach, read, change or flood that I should not:
  an input, a URL, a file name, a message that is also an instruction.

Suggested by the agent, for the author to confirm:

- **Operator.** It failed at night and I have the logs and the data folder:
  can I tell what happened, and restart it without losing anything?
- **Next developer.** I open the code a year from now: can I find where this
  lives, read why it is so, and change it without breaking the rest?
- **Newcomer.** I see it the first time, with no context: does the screen
  say what it is, what to do, and what just happened?

#### The rule

1. **Tell each story before the first edit.** One or two lines each, in the
   person's words: "I click, my answer is under the last message". A view
   that does not apply is skipped, not forgotten.
2. **The screen follows the user's story.** When the implementation takes a
   longer way (a queue, an inbox, a second agent), the user still sees the
   result where they acted, at once, marked as pending until the way ends.
   The route stays inside.
3. **Each story gets its test.** The user's story is an e2e test of what
   the screen shows and when; the attacker's is a test of what is refused.
4. **Report by story.** The reply says what each view found, and what was
   changed for it, so the author need not read the work through each pair
   of eyes again.

<!-- rules: end -->
