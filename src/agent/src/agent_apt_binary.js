// What apt-get is on this machine, without anything in front of it. The real work goes
// through sudo where the agent is not root; asking apt what it would do needs no such thing.
function agent_apt_binary(options)
{
    if ((options !== undefined) && (options.apt !== undefined) && (options.apt !== '')) {
        return options.apt;
    }
    return 'apt-get';
}

module.exports = agent_apt_binary;
