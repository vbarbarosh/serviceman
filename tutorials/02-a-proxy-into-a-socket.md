# 02. A proxy into a socket

A program with no port of its own, listening on a socket file in serviceman's `data/` folder:
**New service**, **A proxy**, gives it an address; serviceman passes every request into the
file, says so until the program listens, then picks it up by itself. Behind authwall, the
program hears who signed in.

**Before it starts:** a fresh serviceman with `authwall` (at `authwall.localhost`, a user `demo`,
password `demo-pass-1234`) and one machine, `laptop`; `chat`, a small program that listens on the
socket file it is given and answers "Hello, stranger", or "Hello, you" with the `X-Auth-User`
serviceman passes it, in an element `#who`.

## Flowchart

- `have`, a step: chat, a program with no port; New service
- `kind`, a question: what kind? **A proxy**; or a docker image (not shown)
- `where`, a question: where is its socket? serviceman's `data/`; or on a machine (not shown)
- `listens`, a question: is it listening yet? Yes, started; no: `bad`, 502 until it does
- `wall`, a question: behind authwall? Yes, the box; no: `open`, hello, stranger
- `signed`, a question: is the visitor signed in? No; yes: `straight`, straight in
- `signin`, a step: authwall, sign in as demo
- `hello`, the end: hello, you: it knows who

## Steps

### 1. have

- **Do:** open **New service**, `http://serviceman.localhost:3001/services/new`.
- **See:** its three tiles, **A docker image**, **An app folder** and **A proxy**.
- **Say:** chat is a program with no port: it listens on a socket file. New service gives it an address.

### 2. kind

- **Do:** click **A proxy**; type the name `chat`.
- **See:** the proxy's form, its socket in serviceman's own `data/` folder.
- **Say:** Pick A proxy and name it chat. Its socket goes in serviceman's own data folder.

### 3. where

- **Do:** leave **serviceman's own data/ folder** chosen; **Create service**.
- **See:** chat's own page, `/services/chat`.
- **Say:** Create it. serviceman will pass every request into data, sockets, chat dot sock.

### 4. bad

- **Do:** open `http://chat.localhost:3000/`.
- **See:** status 502: the page says the service did not answer.
- **Say:** Nothing listens on that file yet, so the address says the service did not answer.

### 5. listens

- **Do:** start chat, listening on `data/sockets/chat.sock`.
- **See:** the same page turns into chat by itself: "Hello, stranger".
- **Say:** Start the program on that file, and the waiting page picks it up by itself.

### 6. wall

- **Do:** on **Apps**, **Settings** on chat's card; tick **Behind authwall**; **Save**.
- **See:** a lock beside chat's address on its card.
- **Say:** One box in its Settings puts chat behind authwall.

### 7. signin

- **Do:** open `http://chat.localhost:3000/`; type `demo` and `demo-pass-1234`; **Sign in**.
- **See:** authwall's sign-in page first, then chat: "Hello, you", with the user's id in `#who`.
- **Say:** A visitor signs in first. Then chat says hello to them: serviceman tells it who signed in.

### 8. straight

- **Do:** reload the page.
- **See:** chat again, the same user in `#who`, no sign-in.
- **Say:** Signed in, a visit goes straight to chat.
