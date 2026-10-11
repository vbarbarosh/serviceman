# Access ClickHouse from a local Docker container through a Unix socket

The socket forwards to the read-only nginx proxy on `127.0.0.1:8081`. The
proxy supplies the passwordless `log_ui` ClickHouse account, so clients do not
need to store credentials.

## 1. Create the socket on the host

Create a directory that can be bind-mounted into the client container:

```bash
mkdir -p /tmp/clickstack-sockets
```

Run the relay and leave it running:

```bash
socat \
  UNIX-LISTEN:/tmp/clickstack-sockets/clickhouse-http.sock,fork,unlink-early,mode=666 \
  TCP:127.0.0.1:8081
```

## 2. Mount the socket directory

```bash
docker run --rm -it \
  -v /tmp/clickstack-sockets:/run/clickstack \
  ubuntu:latest
```

Mount the containing directory rather than the socket file. That allows the
relay to recreate the socket without leaving the container attached to a stale
socket inode.

## 3. Query from the container

Install `curl` if the client image does not already provide it, then use the
nginx `/clickhouse` endpoint:

```bash
curl \
  --unix-socket /run/clickstack/clickhouse-http.sock \
  http://localhost/clickhouse \
  --data-binary 'SELECT 1'
```

Query logs:

```bash
curl \
  --unix-socket /run/clickstack/clickhouse-http.sock \
  http://localhost/clickhouse \
  --data-binary 'SELECT count() FROM default.otel_logs'
```

The root path `/` is the Logline web UI and rejects POST requests. SQL queries
must use `/clickhouse`.

## Optional: present it as TCP inside the container

For an application that cannot use Unix sockets, run a second relay inside the
container:

```bash
socat \
  TCP-LISTEN:8123,bind=127.0.0.1,reuseaddr,fork \
  UNIX-CONNECT:/run/clickstack/clickhouse-http.sock
```

The application can then use `http://127.0.0.1:8123/clickhouse`.

`mode=666` is convenient for an isolated development machine. Prefer
`mode=660` with a shared group when other local users are untrusted. The
`log_ui` account is read-only and is granted `SELECT` only on
`default.otel_logs`.
