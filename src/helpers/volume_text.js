const path = require('path');

// One storage line as docker takes it. A path the service keeps is a folder under the folder
// of whoever runs it — the agent's own directory over there, serviceman's own here — so the
// machine that will run the container is the one that writes this line.
function volume_text(volume, keep_root)
{
    const source = ((volume.kind === 'kept') ? path.join((keep_root === undefined) ? '.' : keep_root, 'data', volume.keep) : volume.source);
    if (volume.readonly) {
        return `${source}:${volume.target}:ro`;
    }
    return `${source}:${volume.target}`;
}

module.exports = volume_text;
