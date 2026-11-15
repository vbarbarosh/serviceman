# 04. An app folder on a machine

A zip of an app folder with `bin/run` in it: **New service**, **An app folder**, copies it to a
machine whose agent dialled in, where it sleeps until somebody visits. Behind authwall, a
stranger asking for its page is sent to sign in and wakes nothing; authwall's own sign-in page
asks the app for `/favicon.ico`, which authwall lets through, and that wakes it.

**Before it starts:** a fresh serviceman with `authwall` (at `authwall.localhost`, a user `demo`,
password `demo-pass-1234`) and one machine, `laptop`, its agent dialled in; `notes-app.zip`, a
folder with `bin/run` starting a small server on `PORT`, titled "Notes", which shows the
`X-Auth-User` it is given in an element `#who`.

## Flowchart

- `have`, a step: notes-app.zip, bin/run and server.js; New service
- `kind`, a question: what kind? **An app folder**; or a docker image (not shown)
- `where`, a question: which machine? laptop; or another one (not shown)
- `asleep`, a step: asleep, nothing runs yet
- `wall`, a question: behind authwall? Yes, the box; no: any visit wakes it (not shown)
- `page`, a step: a stranger asks for its page; still asleep
- `public`, a question: a path authwall makes public? Yes: `fav`, `/favicon.ico` wakes it; no
- `signin`, a step: authwall asks to sign in
- `app`, the end: the app, for you

## Steps

### 1. have

- **Do:** open **New service**, `http://serviceman.localhost:3001/services/new`.
- **See:** its three tiles, **An app folder** among them.
- **Say:** notes-app is a folder with bin run in it. serviceman runs it on a machine, only while somebody uses it.

### 2. kind

- **Do:** click **An app folder**; **A .zip…** and pick `notes-app.zip`.
- **See:** the zip named in the form, with how many files it holds, laptop as its machine.
- **Say:** Pick An app folder, and give it the zip.

### 3. where

- **Do:** leave **laptop** chosen; **Create service**.
- **See:** notes-app's own page, `/services/notes-app`.
- **Say:** It goes to laptop, the machine whose agent dialled in. serviceman copies it there.

### 4. asleep

- **Do:** open **Apps**.
- **See:** notes-app's card, asleep.
- **Say:** On Apps it is asleep: nothing runs until somebody visits.

### 5. wall

- **Do:** **Settings** on notes-app's card; tick **Behind authwall**; **Save**.
- **See:** a lock beside its address on its card.
- **Say:** One box in its Settings puts it behind authwall.

### 6. page

- **Do:** a stranger asks for `http://notes-app.localhost:3000/`.
- **See:** a redirect to `/auth/sign-in`; notes-app still asleep.
- **Say:** A stranger who asks for its page is sent to sign in, and nothing is woken.

### 7. fav

- **Do:** open `http://notes-app.localhost:3000/` in the browser.
- **See:** authwall's sign-in page, and notes-app starting.
- **Say:** But authwall's sign-in page asks the app for its favicon, which authwall lets through, and that wakes it.

### 8. app

- **Do:** type `demo` and `demo-pass-1234`; **Sign in**.
- **See:** the app, titled "Notes", the user's id in `#who`.
- **Say:** Signed in, demo gets the app, and the app is told who signed in.
