# 03. Something already running

A dashboard that already answers on a port of this computer: **New service**, **All
settings…**, **Something already running** gives it an address; the **Sign-in** box on its
page's **Addresses** card puts authwall in front of it.

**Before it starts:** a fresh serviceman with `authwall` as
[00](00-authwall.md) leaves it (its user `demo`, password `demo-pass-1234`); `dash`, a small page titled "Dashboard" already listening on
`127.0.0.1:8090`, which shows the `X-Auth-User` it is given in an element `#who` ("none"
without one).

## Flowchart

- `have`, a step: a dashboard on 127.0.0.1:8090; New service
- `kind`, a question: what kind? **Something already running**; or a program serviceman starts (not shown)
- `ready`, a step: dash.localhost answers
- `wall`, a question: behind authwall? Yes, the Sign-in box; no: `open`, anyone sees it
- `signed`, a question: is the visitor signed in? No; yes: `straight`, straight in
- `signin`, a step: authwall asks to sign in
- `right`, a question: is the password right? Yes; no: `refused`, the sign-in stays (not shown)
- `dash`, the end: the dashboard, for you

## Steps

### 1. have

- **Do:** open **New service**, `http://serviceman.localhost:3001/services/new`.
- **See:** the short form, with **All settings…** at its foot.
- **Say:** A dashboard already answers on port 8090. serviceman can give it an address without starting anything.

### 2. kind

- **Do:** **All settings…**; **Something already running**; name `dash`, where it answers `127.0.0.1:8090`, address `dash.localhost`; **Create service**.
- **See:** dash's own page, `/services/dash`.
- **Say:** In All settings, pick Something already running, say where it answers, and give it an address.

### 3. ready

- **Do:** open `http://dash.localhost:3000/`.
- **See:** the dashboard, `#who` says "none".
- **Say:** dash dot localhost answers now, and anyone on this computer sees the dashboard.

### 4. wall

- **Do:** on dash's page, **Edit** on the **Addresses** card; tick the box "every visitor signs in first"; **Save**.
- **See:** the card says dash.localhost is behind authwall.
- **Say:** On its page, the Addresses card has a Sign-in box. Tick it, and save.

### 5. signin

- **Do:** open `http://dash.localhost:3000/`; type `demo` and `demo-pass-1234`; **Sign in**.
- **See:** authwall's sign-in page first, then the dashboard, `#who` holding the user's id.
- **Say:** Now a visitor signs in first, and the dashboard is told who they are.

### 6. straight

- **Do:** reload the page.
- **See:** the dashboard again, the same user in `#who`, no sign-in.
- **Say:** Signed in, a visit goes straight to the dashboard.
