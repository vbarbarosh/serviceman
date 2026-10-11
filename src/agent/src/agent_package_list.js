const agent_apt_binary = require('./agent_apt_binary');
const agent_shell = require('./agent_shell');
const argv_line = require('../../helpers/argv_line');
const package_list_from_dpkg = require('./package_list_from_dpkg');

// dpkg-query reads the \t and \n itself, so the command copied from the page is one line
const FORMAT = '${db:Status-Abbrev}\\t${Package}\\t${Architecture}\\t${Version}\\t${Installed-Size}\\t${Section}\\t${binary:Summary}\\n';

// Every package dpkg has installed on this machine: which were asked for by name and which
// came along as something else's need, which are held, and which an upgrade would move on.
// None of it needs root; the dry run reads the lists the last `apt-get update` left.
async function agent_package_list(options)
{
    const argvs = [['dpkg-query', '-W', '-f', FORMAT], ['apt-mark', 'showmanual'], ['apt-mark', 'showhold'], [agent_apt_binary(options), '-s', 'upgrade']];
    const status = await agent_shell(argvs[0]);
    if (status.ok === false) {
        throw new Error(/ENOENT/.test(status.stderr) ? 'this machine has no dpkg: it is not a Debian or an Ubuntu' : `dpkg-query: ${status.stderr}`);
    }
    const all = await Promise.all(argvs.slice(1).map(v => agent_shell(v)));
    const items = package_list_from_dpkg(status.stdout, all[0].stdout, all[1].stdout, all[2].ok ? all[2].stdout : '');
    // Without apt-mark every package would read as a dependency, and without the dry run as
    // up to date: the page says which of the two it could not tell
    return {at: Date.now(), items, manual_known: all[0].ok, updates_known: all[2].ok, commands: argvs.map(argv_line)};
}

module.exports = agent_package_list;
