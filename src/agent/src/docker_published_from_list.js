// The running containers as docker lists them (GET /containers/json): every one's id, and each
// port it publishes on the machine, as docker says it — the address it took (0.0.0.0 and :: are
// every address the machine has), the machine's port, its protocol and the container's port. A
// port the image only names, published nowhere, has no port of the machine and is left out.
//
//     -> {ids, published: [{id, name, image, address, port, proto, private}]}
function docker_published_from_list(list)
{
    const ids = [];
    const published = [];
    for (const item of list) {
        ids.push(item.Id);
        const names = Array.isArray(item.Names) ? item.Names : [];
        const name = (names.length === 0) ? '' : names[0].replace(/^\//, '');
        for (const port of (Array.isArray(item.Ports) ? item.Ports : [])) {
            if (Number.isInteger(port.PublicPort) === false) {
                continue;
            }
            published.push({id: item.Id, name, image: item.Image, address: (typeof port.IP === 'string') ? port.IP : null, port: port.PublicPort, proto: port.Type, private: port.PrivatePort});
        }
    }
    return {ids, published};
}

module.exports = docker_published_from_list;
