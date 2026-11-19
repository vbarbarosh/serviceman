# Databases

A database on one of your machines, in a server serviceman brings up there in docker, always
up, its data kept there. An app given it finds it in `DATABASE_URL` at every start, as a user of
its own; an Adminer given one opens on it, logged in.

The page is **Databases**, in the first crumb's menu: one table, a row a database, with its
engine and version, its machine, its size, the apps given it and how it stands. A server with no
database to show (empty, coming up, failed, its machine away) is a row of its own. A find box
and the chips **All**, **Running** and **Needs you** narrow it; a click on a row opens the
database's page, at `/databases/<server>/<database>`.

## New database

**+ New database** opens a form of five steps, step by step or on one page, as New service
does; it opens at `/databases/new`, from **Database** in New service's first step, from **+ New
database here** on a machine's Databases tab (that machine picked), and from **New database…**
in an app's Data tab (that app ticked).

1. **What:** a database; **Another kind** goes back to New service.
2. **Engine:** PostgreSQL 17 or 16, MySQL 8.4 or 8.0, CouchDB 3, the official image
   (`docker.io/library/postgres:<version>`, `mysql:<version>`, `couchdb:3`); an empty database
   or a sample (below); its name, up to 32 small letters, digits and `_`, a letter first.
3. **Machine:** a card each, its system, its free memory and how many services it runs; one that
   is offline or has no docker its agent reaches is shown, and says why. **Add a machine** opens
   New remote and comes back with every answer kept and the new machine picked.
4. **Given to:** every app, those on that machine that serviceman starts (a docker image, an app
   folder, a program) ticked or not; one on another machine, a page or an address already running
   is shown, and says why it cannot be. The first one ticked shows what it finds at every start,
   its password hidden: `DATABASE_URL=postgresql://orders:••••••@127.0.0.1:<port>/orders`.
5. **Check:** a row per answer, each with **Change**; the rest as it is today: no backups, reached
   from its machine only, Adminer as an app.

**Create database** puts it in a server of that engine and version already up on that machine;
with none, it brings one up first, named after its engine and the first number free
(`postgresql-1`), and says each step as it takes it: pulling the image, making its container,
waiting for the server to answer, fetching the sample, loading it. Then it makes the database,
with a user of its own named after it, whose rights are on that database alone (in PostgreSQL the
user owns it, and nobody else may connect to it: PostgreSQL lets every user connect to every
database unless told otherwise), and gives it to each app ticked, as its Data tab does. A sample
comes in a server of its own, under its own name. What fails is said in the form, and what was
made stays made.

A server that fails is **failed**, with the reason, on its row and its page; **Bring it up again**
there brings it up where it was, with the password its data was made with.

What serviceman makes on that machine, through its docker's Engine API, reached over the agent's
link:

| What      | Its name               | What it is for                                                   |
|-----------|------------------------|------------------------------------------------------------------|
| container | `serviceman-db-<name>` | the server, restarted with docker (`unless-stopped`): a restart of serviceman or of the agent touches nothing of it |
| volume    | `serviceman-db-<name>` | its data, at `/var/lib/mysql` or `/var/lib/postgresql/data`      |
| network   | `serviceman-databases` | where an app in a container reaches it, by its container's name  |
| port      | `127.0.0.1:<port>`     | where a program on that machine reaches it; docker picks the port, and nothing outside the machine reaches it |

## A database's page

Its name, how it stands, its engine and its machine; its size, its tables, its server and where
it is reached from; the apps given it and the variable each finds it in, each a link to its
service; the databases beside it in its server. **Remove…** is there (below).

## The passwords

serviceman makes root's password and every user's, and keeps them in `data/databases.json`, mode
600, beside what it writes about itself: never in the config, never in an answer to the page.
They reach the machine in the bodies of the Engine API's requests, the container's environment
and an exec's, never on a command line, which every user of the machine can read. The SQL that
makes a user goes into the container as a file only root reads, and is removed once it ran.

An app's `DATABASE_URL` carries its user's password. A program on the machine itself gets it in
the environment the agent starts it with. A container gets it as every variable of its env does,
on the `docker run` line on that machine for the moment it runs; the agent's log writes it
`DATABASE_URL=***`.

## Samples

| Sample  | What it is                                     | Fetched from                                           | Licence      |
|---------|------------------------------------------------|--------------------------------------------------------|--------------|
| Sakila  | a DVD rental shop, 47 thousand rows: 16 tables in MySQL, 21 in PostgreSQL | jOOQ's `sakila` on GitHub, commit `e089a5b` | BSD-2-Clause |
| Chinook | a music store, 11 tables, 15 thousand rows     | `lerocha/chinook-database` on GitHub, release `v1.4.5` | MIT          |

Each engine has its own files of each sample. PostgreSQL's Sakila loads into a database made
for it first, afresh; its Chinook makes its own.

Each file is fetched once by serviceman from that address, pinned to that commit or release,
kept in `data/samples/` under its sha256, and loaded only when its sha256 is the one written in
`database_samples.js`. A file that changed there is refused: the server fails, saying the sha256
it found, and nothing of it is run. The sample's database gets a user of its own, as one made
in New database does.

## An app picks one

In an app's **Settings** on Apps, its **Data** tab: **+ Database** lists the databases of every
server, those on the app's own machine with a user serviceman made to pick, the others greyed,
saying why; **New database…** opens New database with the app ticked. The pick is written into the app's config as `databases`, each one variable of its
env:

```json
{
    "name": "adminer",
    "type": "docker",
    "remotes": ["laptop"],
    "image": "adminer",
    "publish": {"host": "adminer.localhost", "port": 8080},
    "databases": [{"server": "mysql-1", "database": "sakila", "env": "DATABASE_URL"}]
}
```

At every start the variable holds the database's own user, its password and where the app
reaches it:

    mysql://sakila:<password>@serviceman-db-mysql-1:3306/sakila     an app in a container
    mysql://sakila:<password>@127.0.0.1:<port>/sakila                a program on the machine
    postgresql://sakila:<password>@serviceman-db-postgresql-1:5432/sakila

An app in a container, a docker image or a program in an image, is put on the
`serviceman-databases` network to reach the server there. A pick of another machine's database,
or of one that is not there or not up, stops the start with the reason, rather than start an app
that finds no database. The tab shows the URL with its password as dots: the page never has it.

### Adminer

An app of Adminer's own image (`adminer`, any tag) given a database opens on its `DATABASE_URL`,
logged in as its user, for a visitor signed in through its wall: serviceman puts a plugin into
the container as it starts (`src/main/adminer/serviceman_database.php`). serviceman says who the
visitor is in `X-Auth-User` and drops any a visitor sends, so the plugin lets in only whom the
wall let in. Without a wall it lets nobody in and says so; a server typed in its form is
never reached. Its Data tab says which of the two it is.

The single `adminer.php` does the same: dropped on **Apps**, it runs on the machine picked, in
serviceman's PHP image ([a PHP file](config.md#a-php-file)), and its folder holds the plugin and
the `adminer-plugins.php` that Adminer loads beside itself. Its container is made on
`serviceman-databases`, by an agent that can (an older one joins it once it is made).

## CouchDB, for a wall's users

**New database** with **CouchDB** brings up CouchDB 3, `docker.io/library/couchdb:3`, the same way: its data in a
volume at `/opt/couchdb/data`, port 5984 on `127.0.0.1` of its machine and on the databases'
network, never outside it. It is for a wall that gives each user it signs in a database of their
own: CouchDB trusts the user name the wall sends in `X-Forwarded-User` when
`X-Forwarded-User-Token` is that name's HMAC-SHA256 by a secret the two share.

serviceman makes its admin's password and that secret, 64 hex digits, keeps them in
`data/databases.json` with the other passwords, and before it starts lays `authwall.ini` into
`/opt/couchdb/etc/local.d` (`src/main/src/helpers/couchdb_ini.js`):

```ini
[chttpd]
authentication_handlers = proxy, cookie, default

[chttpd_auth]
proxy_use_secret = true
secret = <the secret>
x_auth_username = X-Forwarded-User
x_auth_token = X-Forwarded-User-Token
hash_algorithms = sha256, sha

[couchdb]
single_node = true
```

It is one row, **admin**: every database in it, counted with their size, made by the app given
it, one for each user; New database makes none in it. An app picks it in its Data tab as
**admin · couchdb-1** and finds, at every start:

| Variable         | What it holds                                                                    |
|------------------|----------------------------------------------------------------------------------|
| `COUCHDB_URL`    | `http://admin:<password>@serviceman-db-couchdb-1:5984`; on the machine, `127.0.0.1:<port>` |
| `COUCHDB_SECRET` | the secret, to sign a user name with                                             |

A variable named otherwise has its secret beside it the same way: `STORE_URL` and
`STORE_SECRET`, `COUCHDB_URL_2` and `COUCHDB_SECRET_2`. From the app's side, alice signed in:

```sh
T=$(printf alice | openssl dgst -sha256 -hmac "$COUCHDB_SECRET" | sed 's/.* //')
curl -s -H 'X-Forwarded-User: alice' -H "X-Forwarded-User-Token: $T" http://serviceman-db-couchdb-1:5984/_session
```

says `"name":"alice"` in `userCtx`; signed by another secret, `"name":null`. CouchDB 3.5 answers
a user name sent with no token at all with an error, 500 `badarg`, and lets nobody in either way:
the wall takes `X-Forwarded-User` out of what a visitor sends before it adds its own.

## Remove

**Remove…**, on a database's page, removes its server: it names the databases beside it that go
too and the apps given them, asks for the server's name typed again, then takes its container and
its volume away, with every database in it. An app that picked one of them stops at its next start, saying
so. A machine that is offline keeps them: Remove is refused until it is back.

## For whoever runs it

| Where                                          | What is there                                                |
|------------------------------------------------|--------------------------------------------------------------|
| `data/databases.json`                          | the servers, their root passwords and their users, mode 600  |
| `data/samples/<sha256>.sql`                    | the samples, as fetched                                      |
| `docker ps --filter label=serviceman.database` | the servers' containers, on their machine                    |
| `docker logs serviceman-db-<name>`             | what MySQL or PostgreSQL said, on its machine                |
| `database_*` in serviceman's log               | each server brought up, made, removed ([The log](logs.md))   |
