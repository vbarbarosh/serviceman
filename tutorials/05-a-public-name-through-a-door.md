# 05. A public name through a door

A site already on **Apps**, behind authwall, given a public name in its **Settings**, through
the door of a machine that takes traffic from outside. That machine's door asks authwall
first, so a visitor signs in on the public name itself.

**Before it starts:** a fresh serviceman with `authwall` as
[00](00-authwall.md) leaves it (its user `demo`, password `demo-pass-1234`), `my-site` (a folder of files, titled "My site", at
`my-site.localhost`, behind authwall) and one machine, `laptop`, its agent dialled in with its
door open; in front of that door, port `8443` of this computer, and `my-site.example.test`
pointing at it, as a public name would point at a machine's front.

## Flowchart

- `have`, a step: my-site, behind authwall; its Settings
- `addr`, a question: a public address? `my-site.example.test`; no: this computer only (not shown)
- `door`, a question: through whose door? laptop; or another machine (not shown)
- `table`, a step: laptop's door asks authwall
- `front`, a step: its front, port 8443 to the door
- `signed`, a question: is the visitor signed in? No; yes: `straight`, straight in
- `signin`, a step: sign in, on that name
- `site`, the end: the site, from outside

## Steps

### 1. have

- **Do:** open **Apps**, `http://serviceman.localhost:3001/apps`.
- **See:** my-site's card, a lock beside its address.
- **Say:** my-site is on Apps, behind authwall, on this computer only. Now it gets a public name.

### 2. addr

- **Do:** **Settings** on my-site's card; under **Public address** type `my-site.example.test`.
- **See:** the new address, with the machine whose door will answer it.
- **Say:** In its Settings, type the public address.

### 3. door

- **Do:** leave **laptop** as the door it goes through; **Save**.
- **See:** the window closes; laptop's door table names my-site for that name, asking authwall first.
- **Say:** It goes through laptop's door. Save, and laptop's door learns the name, with authwall in front of it.

### 4. front

- **Do:** nothing: the public name points at laptop's front, port 8443.
- **See:** nothing new: the next step goes there.
- **Say:** The public name points at laptop, and laptop passes the visit on to serviceman.

### 5. signin

- **Do:** open `http://my-site.example.test:8443/`.
- **See:** authwall's sign-in page, on `my-site.example.test:8443`.
- **Say:** A visitor from outside is asked to sign in first, on the public name itself.

### 6. site

- **Do:** type `demo` and `demo-pass-1234`; **Sign in**.
- **See:** the site, at `http://my-site.example.test:8443/`.
- **Say:** Signed in, demo gets the site, from outside.

### 7. straight

- **Do:** reload the page.
- **See:** the site again, no sign-in.
- **Say:** And a signed-in visit goes straight to it.
