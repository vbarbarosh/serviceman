// What apt-get is on this machine, without anything in front of it. The real work goes
// through sudo where the agent is not root; asking apt what it would do needs no such thing.
function agent_apt_binary(options)
{
    // `sudo -n apt-get` names a line, not a program: its last word is apt-get itself
    if ((options !== undefined) && (options.apt !== undefined) && (options.apt.trim() !== '')) {
        return options.apt.trim().split(/\s+/).pop();
    }
    return 'apt-get';
}

module.exports = agent_apt_binary;
