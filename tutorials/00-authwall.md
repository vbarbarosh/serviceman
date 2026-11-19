# 00. authwall, set up once

authwall asks a visitor to sign in before a service answers them. serviceman asks it, on every
address of every service that stands behind it, when that service names it. It is set up once,
here, as a service called `authwall`; the tutorials after this one start with it there.

**Before it starts:** a fresh serviceman and one machine, `laptop`, its agent dialled in, with
docker; nothing called `authwall` yet.

## Flowchart

- `have`, a step: authwall, a docker image; New service
- `kind`, a question: what kind? **A docker image**; or something already running (not shown)
- `named`, a step: its name is `authwall`, the name every other service asks for
- `user`, a step: its first user, in its environment
- `kept`, a step: `/app/data` kept, its users and its key
- `ready`, the end: **behind authwall** in every app's **Sign-in**

## Steps

### 1. have

- **Do:** open **New service**, `http://serviceman.localhost:3001/services/new`.
- **See:** its three tiles, **A docker image** among them.
- **Say:** authwall asks visitors to sign in. Every tutorial after this one uses it, so it is set up once, here.

### 2. kind

- **Do:** click **A docker image**; image `vbarbarosh/authwall:latest`; name `authwall`; port inside `3000`; machine `laptop`; **Create service**.
- **See:** authwall's own page, `/services/authwall`, its address `authwall.localhost`.
- **Say:** It is a docker image. Name it authwall: that is the name the other services ask for.

### 3. user

- **Do:** on its page, **Edit** on **What runs**; under **Environment** add `AUTHWALL_SEED` = `demo:demo-pass-1234:user@example.com`; **Save**.
- **See:** the card lists `AUTHWALL_SEED`.
- **Say:** Its first user goes in its environment: a name, a password and an email.

### 4. kept

- **Do:** **Edit** on **Storage and secrets**; **+ path**, `/app/data`; **Save**.
- **See:** the card lists `/app/data`, kept on laptop.
- **Say:** Keep its data folder, and its users and its key survive a new container.

### 5. signin

- **Do:** open `http://authwall.localhost:3000/auth/sign-in`; type `demo` and `demo-pass-1234`; **Sign in**.
- **See:** authwall starts on laptop, its sign-in page answers, and demo is signed in.
- **Say:** Its own sign-in page answers, and demo can sign in.

### 6. ready

- **Do:** open **Apps**, **Settings** on any app.
- **See:** its **Sign-in** list, **behind authwall · family** in it, and **Authwall** on All categories.
- **Say:** Now every app's Settings can put it behind authwall. The tutorials after this one start here.
