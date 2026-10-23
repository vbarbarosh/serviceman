# module-host

serviceman's modules on this computer, in a page of their own: no serviceman and no agent. Each
module is given what it asks of its host by this computer itself, through the same calls the
ServiceMan agent makes on its machine, here without a link in between.

Today it loads one module, the **Firewall** (`modules/firewall`): the ports this computer
listens on, how far each reaches, what ufw does to each, and ufw's rules, on or off.

## Run

    PORT=3002 node src/module-host/index.js

Then open http://localhost:3002/. It needs node, and the vendored Vue in `src/main/public/vendor`
(`bin/vendor`). For the Firewall:

- `ss` (iproute2) for the ports. Run as yourself, it names the holders of your own sockets only;
  as root, every one.
- `ufw`, run as `sudo -n ufw`, so a sudoers line names it and nothing else:

      echo "$USER ALL=(root) NOPASSWD: /usr/sbin/ufw" | sudo tee /etc/sudoers.d/module-host-ufw

  Without the line the page says sudo wants a password. Run as root, ufw is run as it is.
  `UFW` names another ufw, such as the module's fake one:

      UFW="node modules/firewall/tests/fake_ufw.js" FAKE_UFW_STATE=/tmp/ufw.json node src/module-host/index.js

## Who may ask

It listens on 127.0.0.1 only, and answers only its own page: a request whose Host is not
`localhost` or `127.0.0.1` is refused (a site that points a name of its own at 127.0.0.1), and
a change must carry the Origin of that page (another site open in the same browser). ufw runs as
root behind it.

## Layout

    index.js                 the server, PORT
    src/modules_served.js    the modules: each one's page half and its API, with what it is given
    src/request_answer.js    the page, /api/modules, /api/v1/modules, /api/machine, /api/<module>…, the files
    src/request_allowed.js   only this computer's own page
    public/module_host.js    the page: this computer's name, the modules, the one open

A module is added in two places: its entry in `src/modules_served.js` (where its page half is,
and its API with what this computer gives it), and what its component is given in
`MODULE_PROPS` in `public/module_host.js`.
