// The speed across a copy, for its graph: sampled every second, as how fast the last three
// seconds went; past the most points kept, every other one goes
const SAMPLE_MS = 1000;
const SAMPLE_SPAN_MS = 3000;
const SAMPLES_MAX = 400;

// Bytes going somewhere for a service, kept on it for the page, which draws it as every copy is
// drawn (copy_progress): a new version sent to its machine, an image coming down. The work fills
// the copy as it goes; this samples its speed. Answers with the function that ends it, which
// takes the copy off the service.
//
//     copy = {title, unit, files, files_done, bytes, bytes_done, ratio, now}
//     unit     what files are called: file, or layer for an image
//     ratio    how far, 0 to 1, for a copy whose bytes are not all known (an image's layers);
//              null to count by bytes
//     now      what is on its way: {label, size, done}, or null
function service_copy_start(service, copy)
{
    const kept = Object.assign({samples: [], began_ms: Date.now()}, copy);
    service.state.copy = kept;
    const seen = [];
    const timer = setInterval(function () {
        const now = Date.now();
        seen.push([now, kept.bytes_done]);
        while ((seen.length > 1) && (now - seen[0][0] > SAMPLE_SPAN_MS)) {
            seen.shift();
        }
        const x = ratio_of(kept);
        if ((seen.length < 2) || (x === null)) {
            return;
        }
        const speed = Math.max(0, (kept.bytes_done - seen[0][1])*1000/(now - seen[0][0]));
        const samples = kept.samples.filter(v => v.x <= x);
        samples.push({x, y: speed});
        kept.samples = (samples.length > SAMPLES_MAX) ? samples.filter((v, index) => (index % 2 === 0)) : samples;
    }, SAMPLE_MS);
    timer.unref();
    return function () {
        clearInterval(timer);
        if (service.state.copy === kept) {
            service.state.copy = null;
        }
    };
}

function ratio_of(copy)
{
    if ((copy.ratio !== null) && (copy.ratio !== undefined)) {
        return Math.min(1, copy.ratio);
    }
    if ((copy.bytes === null) || (copy.bytes === 0)) {
        return null;
    }
    return Math.min(1, copy.bytes_done/copy.bytes);
}

module.exports = service_copy_start;
