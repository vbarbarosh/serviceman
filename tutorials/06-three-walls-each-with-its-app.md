# 06. Three walls, each with its app

Three teams, three ways in, three apps. A wall for a team is made on the **Authwall** page as a
copy of authwall, with its own users; its settings come from one of
[authwall's recipes](https://vbarbarosh.github.io/authwall/recipes.html). One lets in only the
Google accounts you list, one only the users you name, and one is a demo that anybody signs up
to. Then an app goes behind each, and each team gets into its own app and no other.

**Before it starts:** serviceman with `authwall` as [00](00-authwall.md) leaves it, on `laptop`;
three pages, `team-board.html`, `staff-notes.html` and `demo-board.html`, each titled after its
file. For the Google wall, a Google OAuth client
([authwall's Google page](https://vbarbarosh.github.io/authwall/oauth-providers.html#google))
whose authorized redirect URI is `http://team-board.localhost:3000/auth/google/callback`: its
client id and secret.

## Flowchart

- `have`, a step: authwall, on the Authwall page
- `walls`, a step: + A wall for another team, three times: Google, Staff, Demo
- `how`, a question: a wall per team? Yes; no: every app behind authwall, as 01 does (not shown)
- `google`, a step: authwall-google: Google only, the emails listed
- `staff`, a step: authwall-staff: only the users named
- `demo`, a step: authwall-demo as it is: anybody signs up
- `apps`, a step: the three pages given on Apps
- `pick`, a step: each app's Sign-in on its wall
- `visit`, a question: is the visitor signed in at that app? No; yes: `straight`, the app at once
- `signin`, a step: the app's own wall asks, on the app's own name
- `signup`, a step: on the demo, anybody signs up and is in
- `nobody`, a step: the demo's visitor is nobody to the staff wall
- `refused`, a step: a stranger's sign-up is refused there too
- `named`, a step: ann, a user it names, is in
- `button`, a step: the Google wall offers Google only
- `listed`, a step: Google says who; only the addresses listed get in
- `apart`, the end: each team in its own app, and in no other

## Steps

### 1. have

- **Do:** open **Authwall**, `http://serviceman.localhost:3001/authwall`.
- **See:** one card, `authwall`, and **+ A wall for another team**.
- **Say:** This is Authwall. One wall so far: authwall itself.

### 2. walls

- **Do:** **+ A wall for another team**; **Team** `Google`; **Make the wall**. Again with **Team**
  `Staff`, and its **First user** `ann`, `ann-pass-1234`, `ann@example.com`. Again with **Team** `Demo`.
- **See:** four cards: `authwall`, `authwall-demo` (Demo), `authwall-google` (Google),
  `authwall-staff` (Staff), each guarding nothing yet.
- **Say:** Each team gets a wall of its own: a copy of authwall, with its own users and its own data.

### 3. google

- **Do:** on authwall-google's page, **Edit** on **What runs**; under **Environment**, from
  [Team sign-in with Google](https://vbarbarosh.github.io/authwall/recipes.html#team-sign-in-with-google):
  `AUTHWALL_FLOWS` = `google`, `AUTHWALL_GOOGLE_CLIENT_ID` and `AUTHWALL_GOOGLE_CLIENT_SECRET` =
  your client's, `AUTHWALL_GOOGLE_REDIRECT_URL` =
  `http://team-board.localhost:3000/auth/google/callback`, `AUTHWALL_PUBLIC_URL` =
  `http://team-board.localhost:3000`, `AUTHWALL_ALLOWED_EMAILS` =
  `ann@example.com,bob@example.com`; **Save**.
- **See:** the card lists the six variables.
- **Say:** The Google wall asks Google, and lets in only the addresses you list.

### 4. staff

- **Do:** on authwall-staff's page, **Edit** on **What runs**; under **Environment**, from
  [Bootstrap an admin user](https://vbarbarosh.github.io/authwall/recipes.html#bootstrap-an-admin-user):
  `AUTHWALL_SEED` = `[{"username":"ann","password":"ann-pass-1234","emails":"ann@example.com"},{"username":"bob","password":"bob-pass-1234","emails":"bob@example.com"}]`,
  then `AUTHWALL_ALLOWED_EMAILS` = `ann@example.com,bob@example.com`, `AUTHWALL_FLOWS` =
  `username,email` and `AUTHWALL_MAILER` = `fake`; **Save**.
- **See:** the card lists the four variables.
- **Say:** The staff wall knows ann and bob by name. Only their two addresses are allowed, so nobody else can sign up.

An allow list needs sign-in by email, and sign-in by email needs a mailer: `AUTHWALL_MAILER` =
`fake` is one that sends nothing, and `AUTHWALL_FLOWS` keeps the sign-in to a name or an email and
a password, with no magic link that would never arrive. A stranger's sign-up is refused with
"Email is not allowed". authwall has no setting that closes sign-up itself yet, so its
**Create one** link stays on the page.

### 5. demo

- **Do:** nothing: authwall-demo keeps what it was made with, as in
  [Just run it](https://vbarbarosh.github.io/authwall/recipes.html#just-run-it-one-line).
- **See:** its page lists no environment.
- **Say:** The demo wall is left as it is: anybody signs up, with a username and a password.

### 6. apps

- **Do:** open **Apps**; click the drop card and pick `team-board.html`; again with
  `staff-notes.html`, then `demo-board.html`.
- **See:** three cards, `team-board`, `staff-notes` and `demo-board`, each running at its own address.
- **Say:** Three small apps, one page each, one for each team.

### 7. pick

- **Do:** **Settings** on team-board's card; under **Sign-in** pick **behind authwall-google · Google**;
  **Save**. The same for staff-notes, **behind authwall-staff · Staff**, and demo-board,
  **behind authwall-demo · Demo**.
- **See:** a lock beside each app's address.
- **Say:** Each app picks its team's wall in its Settings.

### 8. signin

- **Do:** open `http://demo-board.localhost:3000/`.
- **See:** the demo wall's sign-in page, under `demo-board.localhost:3000/auth/sign-in`.
- **Say:** A visitor is sent to the app's own wall, on the app's own address.

### 9. signup

- **Do:** **Create one**; username `visitor`, password `visitor-pass-1234` twice; **Create account**.
- **See:** the page titled "Demo board".
- **Say:** On the demo, anybody signs up, and is in.

### 10. nobody

- **Do:** open `http://staff-notes.localhost:3000/`; sign in as `visitor`, `visitor-pass-1234`.
- **See:** "Invalid username or password", the sign-in page again.
- **Say:** The demo's visitor is nobody to the staff wall.

### 11. refused

- **Do:** **Create one**; `stranger@example.org` and a password; **Create account**.
- **See:** "Email is not allowed".
- **Say:** A stranger cannot sign up to it either.

### 12. named

- **Do:** sign in as `ann`, `ann-pass-1234`.
- **See:** the page titled "Staff notes".
- **Say:** ann is one of the users it names, so she is in.

### 13. button

- **Do:** open `http://team-board.localhost:3000/`.
- **See:** the Google wall's sign-in, with one button: **Continue with Google**.
- **Say:** The team board asks for Google, and nothing else.

### 14. listed

- **Do:** **Continue with Google**.
- **See:** Google's sign-in, for your client; after it, an address you listed opens "Team board", any other is refused.
- **Say:** Google says who you are; the wall lets in only the addresses on its list.

### 15. apart

- **Do:** signed in as ann on staff-notes, open `http://team-board.localhost:3000/`.
- **See:** the Google wall's sign-in again.
- **Say:** Each team is let into its own app, and into no other.
