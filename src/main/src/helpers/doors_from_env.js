// What serviceman is told of the ways in that it cannot see for itself. In its image the doors
// are the other way round from a machine's: tailscaled hands every tailnet visitor in on the
// container's own loopback (SERVICEMAN_LOOPBACK=tailnet, set by the image), and docker's
// published port arrives on the container's own address, this computer's alone when it was
// published on the machine's loopback (SERVICEMAN_PUBLISHED=loopback, set by bin/run).
//
//     out   {tailnet_on_loopback, published_on_loopback}
function doors_from_env(env)
{
    return {
        tailnet_on_loopback: (env.SERVICEMAN_LOOPBACK === 'tailnet'),
        published_on_loopback: (env.SERVICEMAN_PUBLISHED === 'loopback'),
    };
}

module.exports = doors_from_env;
