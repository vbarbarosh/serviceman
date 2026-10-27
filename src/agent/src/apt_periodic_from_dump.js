// Whether apt is told to install updates by itself, as `apt-config dump` says the setting
// after every file of /etc/apt/apt.conf.d is read: the setting's value ('1' a day, '0' never),
// or null where no file sets it
function apt_periodic_from_dump(text)
{
    const found = /^APT::Periodic::Unattended-Upgrade\s+"([^"]*)";\s*$/m.exec(text);
    return (found === null) ? null : found[1];
}

module.exports = apt_periodic_from_dump;
