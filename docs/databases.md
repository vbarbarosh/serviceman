# Databases

A database server on one of your machines, brought up by serviceman in docker, always up, its
data kept there. An app picks one of its databases in its **Data** tab and finds it in
`DATABASE_URL` at every start, as a user of its own; an Adminer given one opens on it, logged in.

The page is **Databases** in the rail: each server, its machine and how it stands, and a row per
database in it, with its tables, its size and the apps that picked it.

## A server

**+ MySQL** asks four things:

- **Machine:** one that is online, with docker its agent reaches; the others are listed, greyed,
  saying why.
- **MySQL:** 8.4 or 8.0, the official image, `docker.io/library/mysql:<version>`.
- **Filled with:** nothing, or a sample (below).
- **Name:** `mysql-1`, the first number free; up to 40 small letters, digits and hyphens.

**Bring it up**, and the server says each step as it takes it: pulling the image, making its
container, waiting for MySQL to answer, fetching the sample, loading it. Then it is **up**, its
databases listed. A step that fails leaves it **failed**, with the reason; **+ MySQL** with the
same name on the same machine brings it up again, with the password its data was made with.

What serviceman makes on that machine, through its docker's Engine API, reached over the agent's
link:

| What      | Its name               | What it is for                                                   |
|-----------|------------------------|------------------------------------------------------------------|
| container | `serviceman-db-<name>` | the server, restarted with docker (`unless-stopped`): a restart of serviceman or of the agent touches nothing of it |
| volume    | `serviceman-db-<name>` | its data, at `/var/lib/mysql`                                    |
| network   | `serviceman-databases` | where an app in a container reaches it, by its container's name  |
| port      | `127.0.0.1:<port>`     | where a program on that machine reaches it; docker picks the port, and nothing outside the machine reaches it |

## A database in it

**+ Database** makes an empty one, its name up to 32 small letters, digits and `_`, with a user of
its own named after it, whose rights are on that database alone.

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
| Sakila  | a DVD rental shop, 16 tables, 47 thousand rows | jOOQ's `sakila` on GitHub, commit `e089a5b`            | BSD-2-Clause |
| Chinook | a music store, 11 tables, 15 thousand rows     | `lerocha/chinook-database` on GitHub, release `v1.4.5` | MIT          |

Each file is fetched once by serviceman from that address, pinned to that commit or release,
kept in `data/samples/` under its sha256, and loaded only when its sha256 is the one written in
`database_samples.js`. A file that changed there is refused: the server fails, saying the sha256
it found, and nothing of it is run. The sample's database gets a user of its own, as one made
with **+ Database** does.

## An app picks one

In an app's **Settings** on Apps, its **Data** tab: **+ Database** lists the databases of every
server, those on the app's own machine with a user serviceman made to pick, the others greyed,
saying why. The pick is written into the app's config as `databases`, each one variable of its
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

## Remove

**Remove…** asks for the server's name typed again, then takes its container and its volume
away, with every database in it. An app that picked one of them stops at its next start, saying
so. A machine that is offline keeps them: Remove is refused until it is back.

## For whoever runs it

| Where                                          | What is there                                                |
|------------------------------------------------|--------------------------------------------------------------|
| `data/databases.json`                          | the servers, their root passwords and their users, mode 600  |
| `data/samples/<sha256>.sql`                    | the samples, as fetched                                      |
| `docker ps --filter label=serviceman.database` | the servers' containers, on their machine                    |
| `docker logs serviceman-db-<name>`             | what MySQL said, on its machine                              |
| `database_*` in serviceman's log               | each server brought up, made, removed ([The log](logs.md))   |
