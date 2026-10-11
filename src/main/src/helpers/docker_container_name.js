// Every container serviceman creates is named after its service; extra instances count from 2
function docker_container_name(service, slot)
{
    if (slot === 1) {
        return `serviceman-${service.name}`;
    }
    return `serviceman-${service.name}-${slot}`;
}

module.exports = docker_container_name;
