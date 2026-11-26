# Databases

A database on one of your machines, in a server serviceman brings up there in docker, always
up, its data kept there: MySQL, PostgreSQL, MongoDB or CouchDB. An app given it finds it in
`DATABASE_URL` at every start (a MongoDB in `MONGODB_URL`), as a user of its own; an Adminer
given one opens on it, logged in.

The page is **Databases**, under **All categories**: one table, a row a database, with its
engine and version, its machine, its size, the apps given it and how it stands. A server with no
database to show (empty, coming up, failed, its machine away) is a row of its own. A find box
and the chips **All**, **Running** and **Needs you** narrow it; a click on a row opens the
database's page, at `/databases/<server>/<database>`.

## New database

**New database** opens a form of four steps, step by step or on one page, as New service
does; it opens at `/databases/new`, from **Database** in New service's first step, from **+ New
database here** on a machine's Databases tab (that machine picked), and from **New database…**
in an app's Data tab (that app ticked).

1. **Engine:** a tile each, PostgreSQL 17 or 16, MySQL 8.4 or 8.0, MongoDB 8.0 or 7.0, CouchDB 3,
   the official image (`docker.io/library/postgres:<version>`, `mysql:<version>`,
   `mongo:<version>`, `couchdb:3`); its version; and what it starts with, a tile each: an empty
   database or a sample (below). A MongoDB starts empty.
2. **Machine:** a tile each, what it is, how many services it runs and its free memory of all,
   with a meter of it; one that is offline or has no docker its agent reaches is shown, and says
   why. **Add a machine** opens New remote and comes back with every answer kept and the new
   machine picked.
3. **Given to:** every app a row, those on that machine that serviceman starts (a docker image,
   an app folder, a program) ticked or not; one on another machine, a page or an address already
   running is shown, and says why it cannot be. The first one ticked shows what it finds at every
   start, its password hidden: `DATABASE_URL=postgresql://orders:••••••@127.0.0.1:<port>/orders`,
   `MONGODB_URL=mongodb://orders:••••••@serviceman-db-mongodb-1:27017/orders`.
4. **Check:** its name, up to 32 small letters, digits and `_`, a letter first (a sample and a
   CouchDB name it themselves); a row per answer, each with **Change**; the rest as it is today:
   reached from its machine only, Adminer as an app (not for a MongoDB: Adminer speaks SQL).

**Create database** puts it in a server of that engine and version already up on that machine;
with none, it brings one up first, named after its engine and the first number free
(`postgresql-1`), and says each step as it takes it: pulling the image, making its container,
waiting for the server to answer, fetching the sample, loading it. Then it makes the database,
with a user of its own named after it, whose rights are on that database alone (in PostgreSQL the
user owns it, and nobody else may connect to it: PostgreSQL lets every user connect to every
database unless told otherwise; in MongoDB the user is made in that database, which signs it in,
as its `dbOwner`), and gives it to each app ticked, as its Data tab does. A sample
comes in a server of its own, under its own name. What fails is said in the form, and what was
made stays made.

A server that fails is **failed**, with the reason, on its row and its page; **Bring it up again**
there brings it up where it was, with the password its data was made with.

What serviceman makes on that machine, through its docker's Engine API, reached over the agent's
link:

| What      | Its name               | What it is for                                                   |
|-----------|------------------------|------------------------------------------------------------------|
| container | `serviceman-db-<name>` | the server, restarted with docker (`unless-stopped`): a restart of serviceman or of the agent touches nothing of it |
| volume    | `serviceman-db-<name>` | its data, at `/var/lib/mysql`, `/var/lib/postgresql/data` or `/data/db` |
| network   | `serviceman-databases` | where an app in a container reaches it, by its container's name  |
| port      | `127.0.0.1:<port>`     | where a program on that machine reaches it; docker picks the port, and nothing outside the machine reaches it |

## A database's page

Its head: its name, how it stands, its engine, its server and its machine (a link to the
machine's page), then its size, its tables (a MongoDB's collections, a CouchDB's users) and
where it is reached from. Under it, two cards side by side, one above the other on a narrow page:

- **Given to**: the apps given it, each with its kind and machine, the variable it finds it in
  and how it stands; a CouchDB's lists the apps whose store for each user it is too, finding it
  at `/_couch`. **Give it to an app** opens a window of every app: those that reach it to tick,
  on its own machine or, for a program, on a machine its port is
  [brought to](#its-port-on-another-machine), then those given it already, ticked and greyed,
  with their variable, then the others greyed, saying why; each one ticked is given it as its
  Data tab gives one ([below](#an-app-picks-one)), from its next start.
- **How an app reaches it**: the variable it is found in, its user, its URL from a container and
  from its machine (the password as dots), its volume and where in the container it is, and that
  the password stays with serviceman.

Then **Reached from**, its own machine, each other one its port is brought to and its public
port, a line each with how it stands, in a pill (active, starting, set aside, or its machine
offline), and **Copy URL**; on a phone a line's buttons take a row of their own at its foot. Then
the databases beside it in its server, and **Remove…**, a strip at the foot ([Remove](#remove)).
Coming up, its steps are listed, the one now turning; failed, a red note says why, with **Bring
it up again**; its machine away, a red note says so, and its numbers are the last read, with
when. A server with no database in it yet is a page of its own, with
**New database in it**, New database opened on its engine and machine.

## Its data, browsed

A MongoDB's page has **Browse** in its head, which opens its data at
`/databases/<server>/<database>/browse`: the [Data](../modules/data_browser/README.md) module on
it. Its collections down the left, each with how many documents it holds; a click opens one, its
documents as a table, 50 a page, a column for each key found in them, and ‹ › for the pages. A
filter finds them, typed as the MongoDB shell types it, `{status: 'active', joined: {$gte:
ISODate('2025-06-01')}}`; **Sort and fields** opens two more, `{joined: -1}` and `{name: 1,
email: 1}`, and a click on a header sorts by that key, up, then down, then as found. A click on a
row shows the document whole, as the shell writes it, with **Copy**. **Aggregate**, beside
Find, runs a pipeline of stages on it, `[{$match: {status: 'active'}}, {$group: {_id: '$city',
n: {$sum: 1}}}]`, a page at a time; a stage that writes (`$out`, `$merge`) is refused. A page
shows as a table or as **JSON**, 20 to 200 to a page, and **Recent** runs one of the
collection's last queries again, kept in the browser. The collection open is in the address,
`?collection=`, so a reload or a link opens it again.

It reads as the database's own user, inside its server's container, never as root: it sees that
database and no other. What is typed is read as data, never run: a name that is none of the
shell's types, `db.dropDatabase()`, is refused, with where it stands. Its machine away, or the
server not up, Browse is greyed and says why. It reads, for now; PostgreSQL, MySQL and SQLite
files come to the same page.

## The passwords

serviceman makes root's password and every user's, and keeps them in `data/databases.json`, mode
600, beside what it writes about itself: never in the config, never in an answer to the page
but one, the URL **Copy URL** asks for ([below](#its-port-on-another-machine)).
They reach the machine in the bodies of the Engine API's requests, the container's environment
and an exec's, never on a command line, which every user of the machine can read. The SQL that
makes a user goes into the container as a file only root reads, and is removed once it ran; in a
MongoDB, a mongosh script, which signs root in with the password its env holds.

A MongoDB's root, its admin, signs in from inside its own container alone, from the container's
`127.0.0.1`, where serviceman runs those scripts (MongoDB's `authenticationRestrictions`). Through
its port, a forward of it or a public port, only a database's own user signs in, whoever holds
root's password. It is set as the server comes up; on one made before, the first time its
machine's agent dials in, said in the log as `database_root_held`.

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
for it first, afresh; its Chinook makes its own. A MongoDB and a CouchDB start empty.

Each file is fetched once by serviceman from that address, pinned to that commit or release,
kept in `data/samples/` under its sha256, and loaded only when its sha256 is the one written in
`database_samples.js`. A file that changed there is refused: the server fails, saying the sha256
it found, and nothing of it is run. The sample's database gets a user of its own, as one made
in New database does.

## An app picks one

In an app's **Settings** on Apps, its **Data** tab: **+ Database** lists the databases of every
server, those with a user serviceman made to pick, on the app's own machine or, for a program,
on another whose port is [brought to its machine](#its-port-on-another-machine); the others
greyed, saying why; **New database…** opens New database with the app ticked. A database's own
page gives it to apps the same way, from **Give it to an app**. The pick is written into the app's config as `databases`, each one variable of its
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
    mongodb://orders:<password>@serviceman-db-mongodb-1:27017/orders
    mongodb://orders:<password>@127.0.0.1:27017/orders                a program on vps2, through the forward

A MongoDB is given in `MONGODB_URL` unless the row names another variable; its user signs in to
the database in the URL's path, so a driver needs no `authSource`.

An app in a container, a docker image or a program in an image, is put on the
`serviceman-databases` network to reach the server there. A program on another machine reaches
it at the port its forward listens on there; a container there has a `127.0.0.1` of its own,
which the forward does not listen on. A pick of another machine's database not brought there,
of one a container there picked, or of one that is not there or not up, stops the start with
the reason, rather than start an app that finds no database. The tab shows the URL with its password as dots: the page never has it.

### Adminer

An app of Adminer's own image (`adminer`, any tag) given a database opens on its `DATABASE_URL`,
logged in as its user (a MySQL or a PostgreSQL: Adminer does not speak MongoDB, and its Data tab
says so), for a visitor signed in through its wall: serviceman puts a plugin into
the container as it starts (`src/main/adminer/serviceman_database.php`). serviceman says who the
visitor is in `X-Auth-User` and drops any a visitor sends, so the plugin lets in only whom the
wall let in. Without a wall it lets nobody in and says so; a server typed in its form is
never reached. Its Data tab says which of the two it is.

The single `adminer.php` does the same: dropped on **Apps**, it runs on the machine picked, in
serviceman's PHP image ([a PHP file](config.md#a-php-file)), and its folder holds the plugin and
the `adminer-plugins.php` that Adminer loads beside itself. Its container is made on
`serviceman-databases`, by an agent that can (an older one joins it once it is made).

## MongoDB

**New database** with **MongoDB** brings up `docker.io/library/mongo:8.0` (or `7.0`) the same way:
its data in a volume at `/data/db`, port 27017 on `127.0.0.1` of its machine and on the
databases' network, never outside it. Its image makes `root` at its first start, with the
password serviceman made, in a server of its own on `127.0.0.1` that it stops once root is made:
serviceman waits until root signs in to a server that is not that one, so no database is made in
a server about to stop. MongoDB lists a database only once something is written in it; the page
shows one made here from then on, its collections and size 0.

To look inside on its machine, as root, mongosh asking for the password
(`data/databases.json`, `root` of the server) rather than reading it from a command line:

```sh
docker exec -it serviceman-db-mongodb-1 mongosh mongodb://127.0.0.1:27017/admin -u root
```

## CouchDB, for a wall's users

**New database** with **CouchDB** brings up CouchDB 3, `docker.io/library/couchdb:3`, the same way: its data in a
volume at `/opt/couchdb/data`, port 5984 on `127.0.0.1` of its machine and on the databases'
network, never outside it. It gives each user an app's wall signs in a database of their own:
CouchDB trusts the user name sent in `X-Forwarded-User` when `X-Forwarded-User-Token` is that
name's HMAC-SHA256 by a secret only serviceman, the machine's agent and CouchDB hold. The agent at
the machine's door signs it ([A store for each user](#a-store-for-each-user)); an app given the
CouchDB as its admin may sign it itself.

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
whatever signs the name takes `X-Forwarded-User` out of what a visitor sends before it adds its own.

### A store for each user

An app behind a wall picks a CouchDB in its Data tab with **+ Store for each user**, kept in its
config as `"store": {"server": "couchdb-1"}`. It needs no variable and no code of its own on a
server: a page, one HTML file, uses it as it is. At `/_couch` on the app's own name, each user its
wall signs in has a database of their own:

```js
await fetch('/_couch/note-1', {method: 'PUT', body: JSON.stringify({text: 'hello'})});
const note = await fetch('/_couch/note-1').then(v => v.json());
```

The agent at the door of the machine the CouchDB runs on answers it, and serviceman is in no step:
serviceman writes the CouchDB's port, its secret and its admin into that door's table, and the
agent, once the wall has said who the visitor is,

- drops whatever the visitor sent as a name for CouchDB: `Authorization`, `Cookie`,
  `X-Forwarded-User`, its token and `X-Forwarded-Roles`;
- makes that user's database the first time, `userdb-` and the name's bytes in hex, as CouchDB's
  own `couch_peruser` names it, with that user alone as its member;
- carries the request to it on `127.0.0.1`, `/_couch/note-1` as `/userdb-<hex>/note-1`, with the
  name signed.

A path out of the user's own database (`..`, `%2e%2e`) is refused with 400, a visitor not signed
in is sent to sign in, and everything else on the name is the app's. It is answered for a name that
comes in at that machine's door, behind a wall; a name with no wall, or a CouchDB on another
machine, leaves `/_couch` to the app. The door tables are sent again when the CouchDB comes up or
fails. `tests/door_route.test.js` holds it.

#### Its API

`/_couch` is the user's database, and everything under it is CouchDB's own API on that database
([CouchDB's docs](https://docs.couchdb.org/en/stable/api/database/index.html)). A page sends JSON
with `content-type: application/json`; the answers are JSON.

| Request                                         | What it does                                                    |
|-------------------------------------------------|-----------------------------------------------------------------|
| `GET /_couch`                                   | the database: how many documents, its size                      |
| `POST /_couch` and a document                   | saves it under an id CouchDB makes: `{ok, id, rev}`             |
| `PUT /_couch/<id>` and a document               | saves it under that id; changing one needs its `_rev`           |
| `GET /_couch/<id>`                              | one document, with its `_id` and `_rev`                         |
| `DELETE /_couch/<id>?rev=<rev>`                 | deletes it                                                      |
| `GET /_couch/_all_docs?include_docs=true`       | every document, in `rows[].doc`                                 |
| `POST /_couch/_find` and `{selector}`           | the documents a query picks: `{"selector": {"done": false}}`    |
| `POST /_couch/_bulk_docs` and `{docs: […]}`     | many saved, changed or deleted at once                          |
| `PUT /_couch/<id>/<file>?rev=<rev>` and its bytes | a file kept on a document; `GET` the same path reads it back  |
| `GET /_couch/_changes?feed=longpoll&since=now`  | waits until something changes: another tab, another device      |

A change that loses a race answers 409: read the document again, and save it with its new `_rev`.
A page that is not signed in any more gets the wall's sign-in page instead of JSON; it can say so
and send the user to sign in again.

#### A todo list in one file

[demos/couch-todo/index.html](../demos/couch-todo/index.html) is a whole app in one page, with no
server code: it lists the user's todos, adds one with `POST`, ticks one with `PUT` and its `_rev`,
deletes one with `DELETE`, and follows `_changes` so a second tab sees what the first did. Its
store, as it reads them all:

```js
async function todos_read()
{
    const all = await fetch('/_couch/_all_docs?include_docs=true').then(v => v.json());
    return all.rows.map(v => v.doc).filter(v => v.type === 'todo');
}
```

To run it: drop `index.html` on **Apps**, give the page a wall in its **Settings** (Sign-in), and
pick a CouchDB in its **Data** tab with **+ Store for each user**. Then give it a public address on
the machine that CouchDB runs on (its page, **Public addresses**): the store is answered at that
machine's door, and only there. Each user who signs in gets a list of their own; two users never
see each other's.

## Its port on another machine

A server's port, on its machine's `127.0.0.1`, shows up on another machine's loopback as well,
the way `ssh -L` brings one, with no ssh: a [forward](remotes.md#a-port-or-a-socket-from-one-machine-to-another)
that is part of the server. mongodb-1 on vps1, reached on vps2 at `127.0.0.1:27017`:

```json
"forwards": [
    {"label": "mongodb-1 → vps2", "database": "mongodb-1", "from": {"remote": "vps1", "port": 41337}, "to": {"remote": "vps2", "port": 27017}}
]
```

serviceman writes it from where it shows up alone, `PUT /api/v1/databases/<server>/forwards`
with `{"forwards": [{"to": {"remote": "vps2", "port": 27017}}]}`, the whole list each time, an
empty one taking them all out; a place it showed up before keeps its label. Nothing listens
outside the machine's loopback, and nothing opens to the internet.

**Reached from**, on a database's page, lists its own machine and each other one its port is
brought to, with the programs there that picked it, which find it there (a container there
does not), then its public port ([below](#its-port-on-the-internet)); **+ a machine** brings it to another, at the
port its engine listens on unless another is typed, and **×** takes it away from one, saying
which apps there find it no more. A program or an app folder on that machine
[picks it](#an-app-picks-one) in its Data tab, and finds it at the forward's port. **Copy URL**
puts the database's URL, as a program on that machine reaches it, its user's password in it,
on the clipboard, to connect by hand (a shell there, or Compass on the laptop):

    mongodb://orders:<password>@127.0.0.1:27017/orders

It is the one answer that holds a password, `GET /api/v1/databases/<server>/url?database=orders&remote=vps2`,
the owner's alone, written in the log as `database_url_given`, the password left out; the page
keeps it nowhere, and its button's hint shows it as dots.

Docker picks the server's port as its container starts, and picks another at a later start
once the machine or its docker restarted. serviceman reads the port again when the machine's
agent dials in (and a few times in the minutes after, for a container docker starts late), and
every few seconds while Databases is open: a new one is kept, a program on the machine gets it
at its next start, and the server's forwards come from it, said in the log as
`database_port_moved` and `database_forwards_follow`. **Remove…** takes its forwards out with
it, and its answer names them, `forwards_removed`. A token neither sees them nor writes one.

## Its port on the internet

A MongoDB's port, on its machine's public address, for a client anywhere: an app in the cloud,
Compass at home. **+ the internet**, under **Reached from**, opens it: its port there, 27017
unless another is typed; **TLS**, on unless unticked; and who may connect, the addresses and
networks typed (`203.0.113.5, 10.0.0.0/8`), or anyone when none is. **Change** sets them again,
and **×** closes it. It is a forward that is part of the server, its `to` on the server's own
machine with `"host": "0.0.0.0"`:

```json
"forwards": [
    {"label": "mongodb-1 → the internet", "database": "mongodb-1", "from": {"remote": "vps1", "port": 41337}, "to": {"remote": "vps1", "port": 27017, "host": "0.0.0.0"}, "tls": true}
]
```

The machine's agent listens on every address the machine has, and joins each connection to the
server's port on its loopback; one from an address that is not on the list is closed before a
word is said. An agent from before public ports is told nothing of it, and the line says so: it
listens once the agent is updated. The server's root is refused there as everywhere outside its
container ([The passwords](#the-passwords)): only a database's own user signs in. A MongoDB
alone has one: MySQL and PostgreSQL ask for TLS inside their own protocol, and a port that
answered TLS at once would turn their clients away.

**TLS.** serviceman makes an authority of its own for the server and a certificate it signs for
every address the machine is reached at (EC P-256, ten years), keeps them beside the passwords in
`data/databases.json`, and makes them again, said in the log as `database_tls_made`, when the
machine is reached at an address the certificate does not name. **Certificate**, on the line,
hands out the authority's file, `mongodb-1-ca.pem`, the one a client checks the server by
(`GET /api/v1/databases/<server>/certificate`, no secret in it); **Copy URL** gives the URL at
the machine's public address, the file named in it:

    mongodb://orders:<password>@203.0.113.5:27017/orders?tls=true&tlsCAFile=mongodb-1-ca.pem

The public address is the first the machine has that is the internet's, not a private network's
or the tailnet's, or else the one its agent dials serviceman from: a machine behind its
provider's NAT has its public address nowhere on itself. A machine with neither has no Copy URL
for its public port. Unticked, the port speaks no TLS: the password is never sent (MongoDB's
sign-in, SCRAM, does not send it), but every query and answer is readable on the way.

**The firewall.** With the port, serviceman lets it in through the machine's firewall, ufw, by
its agent, as root: a rule for each address it lets in, `allow proto tcp from <address> to any
port 27017`, or one from anywhere, each with the comment `serviceman:<server>:public`; **Change**
replaces them, **×** and **Remove…** take them out (`database_firewall`). With ufw off nothing is
written, and the line under it, by a shield, says the port is open to whoever reaches the
machine; ufw that cannot be run (no ufw, no sudo) is said there too (`database_firewall_error`),
the rule left to the machine's **Firewall** tab. Its port and who it lets in are changed on its
database's page: an edit on **Forwards** keeps its TLS and who it lets in, and tells no firewall.

## Remove

**Remove…**, at the foot of a database's page, removes its server: its window names the
container and the volume that go, the databases beside it that go too and the apps given them,
asks for the server's name typed again, then takes its container and
its volume away, with every database in it, and the unnamed volumes its image declares (a
MongoDB's `/data/configdb`). An app that picked one of them stops at its next start, saying
so. A machine that is offline keeps them: Remove is refused until it is back.

## For whoever runs it

| Where                                          | What is there                                                |
|------------------------------------------------|--------------------------------------------------------------|
| `data/databases.json`                          | the servers, their root passwords and their users, mode 600  |
| `data/samples/<sha256>.sql`                    | the samples, as fetched                                      |
| `docker ps --filter label=serviceman.database` | the servers' containers, on their machine                    |
| `docker logs serviceman-db-<name>`             | what MySQL, PostgreSQL or MongoDB said, on its machine       |
| `database_*` in serviceman's log               | each server brought up, made, removed ([The log](logs.md))   |
