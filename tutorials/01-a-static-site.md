# 01. A static site

A folder of HTML, zipped, given on **Apps**: it answers at once at an address of its own, open
to anyone on this computer; then one box in its **Settings** puts it behind authwall, which asks
a visitor to sign in first.

**Before it starts:** a fresh serviceman with no services but `authwall` (a service at
`authwall.localhost` with a user `demo`, password `demo-pass-1234`); `my-site.zip`, a folder
whose `index.html` is titled "My site", at the top of the zip.

## Flowchart

- `have`, a step: my-site.zip, index.html at the top; picked
- `give`, a question: how is it given? On **Apps**; or with `curl` to `PUT /api/v1/apps` (not shown)
- `ready`, a step: my-site.localhost answers
- `wall`, a question: behind authwall? Yes, the box; no: `open`, anyone opens it
- `signed`, a question: is the visitor signed in? No; yes: `straight`, the site at once
- `signin`, a step: authwall asks to sign in
- `right`, a question: is the password right? Yes; no: `refused`, the sign-in stays
- `site`, the end: the site, for demo

## Steps

### 1. have

- **Do:** open **Apps**, `http://serviceman.localhost:3001/apps`.
- **See:** the drop card, "Drop a .zip, a folder or an .html page here".
- **Say:** This is Apps. A small site is a zip, with its index.html at the top.

### 2. give

- **Do:** click the drop card and pick `my-site.zip`.
- **See:** the card says my-site is ready, with its address and **Open**.
- **Say:** Click the drop card, or drop the zip on it. serviceman unpacks it and gives it an address.

### 3. ready

- **Do:** nothing: read the card.
- **See:** the address starts `http://my-site.localhost:3000`.
- **Say:** It answers at once, at my-site dot localhost, on this computer.

### 4. open

- **Do:** open that address.
- **See:** the page titled "My site".
- **Say:** Open it, and anyone on this computer sees the site. Nothing is asked.

### 5. wall

- **Do:** back on **Apps**, **Settings** on my-site's card; tick **Behind authwall**; **Save**.
- **See:** a lock beside my-site's address on its card.
- **Say:** In its Settings, one box puts it behind authwall. Its card shows a lock.

### 6. signin

- **Do:** open the site's address again.
- **See:** authwall's sign-in page, its address under `/auth/sign-in`.
- **Say:** Now a visitor who has not signed in is sent to authwall first.

### 7. refused

- **Do:** type `demo` and a wrong password; **Sign in**.
- **See:** the sign-in page again, saying the password is invalid.
- **Say:** A wrong password is refused, and the site stays closed.

### 8. site

- **Do:** type `demo` and `demo-pass-1234`; **Sign in**.
- **See:** the site, at `http://my-site.localhost:3000/`.
- **Say:** The right one lets demo in, straight to the site.

### 9. straight

- **Do:** reload the page.
- **See:** the site again, no sign-in.
- **Say:** Signed in, a visit goes straight to the site.
