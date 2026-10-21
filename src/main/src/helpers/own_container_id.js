const fs = require('fs');

// The id of the docker container this serviceman runs in, or null outside one. Docker mounts
// the container's own hostname file from /var/lib/docker/containers/<id>/, whatever hostname
// it was given, and cgroup v1 names the container in the process's cgroup.
function own_container_id()
{
    for (const file of ['/proc/self/mountinfo', '/proc/self/cgroup']) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        }
        catch {
            continue;
        }
        const found = /\/(?:containers|docker)\/([0-9a-f]{64})\b/.exec(text);
        if (found !== null) {
            return found[1];
        }
    }
    return null;
}

module.exports = own_container_id;
