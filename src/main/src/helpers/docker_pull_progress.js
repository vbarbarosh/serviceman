const format_bytes = require('@vbarbarosh/node-helpers/src/format_bytes');
const format_duration_ms = require('../../../helpers/format_duration_ms');
const make_progress = require('@vbarbarosh/node-helpers/src/make_progress');

// `docker pull` writes one line per layer per change, and a layer redraws itself hundreds of
// times over a download. None of them is worth showing to a person; all of them together are:
//
//     8c0575e6ec2e: Pulling fs layer
//     8c0575e6ec2e: Downloading  1.049GB/11.36GB
//     8c0575e6ec2e: Download complete
//     8c0575e6ec2e: Extracting 1 s
//     8c0575e6ec2e: Pull complete
//     0f1e2d3c4b5a: Already exists
//
// What each line looks like past the status is docker's business and changes with the width of
// the terminal it thinks it has — a bar, a pair of sizes, a count of seconds, or nothing at
// all. So every line that names a layer is eaten, and the numbers are taken where they are
// there. What comes out is a sentence for the person waiting.
const RE_LAYER = /^([0-9a-f]{6,}): (.+)$/;
const RE_SIZES = /([0-9.]+\s*[kKMGT]?i?B)\/([0-9.]+\s*[kKMGT]?i?B)/;

// Everything docker says about one layer. Anything else keeping a layer's shape is left alone
// and shown as it came: an error about that layer, most of all.
const STEPS = [
    'Pulling fs layer',
    'Waiting',
    'Downloading',
    'Verifying Checksum',
    'Download complete',
    'Extracting',
    'Pull complete',
    'Already exists',
    'Retrying',
];

// Docker counts in thousands: 12.34MB is 12_340_000 bytes, not 12.34 × 1024²
const UNITS = {b: 1, kb: 1000, mb: 1000000, gb: 1000000000, tb: 1000000000000};

function docker_pull_progress(image)
{
    const layers = {};
    const download = make_progress(0);
    const time0 = Date.now();
    return {
        // Whether the line was one of docker's own about a layer. Those are swallowed: a person
        // watching a page wants the number, not four hundred lines of layer ids.
        read: function (text) {
            const found = RE_LAYER.exec(String(text).trim());
            if (found === null) {
                return false;
            }
            const step = STEPS.find(v => found[2].startsWith(v));
            if (step === undefined) {
                return false;
            }
            layer_step(layer_of(layers, found[1]), step, RE_SIZES.exec(found[2]));
            count(layers, download);
            return true;
        },
        // What to tell the person waiting, and how full to draw the bar. null while docker
        // has named no layer yet.
        status: function () {
            const names = Object.keys(layers);
            if (names.length === 0) {
                return null;
            }
            const pulled = names.filter(v => layers[v].pulled).length;
            // Downloading and unpacking overlap — docker unpacks a layer while the next is
            // still coming — and the one that is not finished is the one worth showing
            if (pulled < names.length) {
                const ratio = part_done(layers)/names.length;
                return {
                    text: `Downloading ${image} — ${Math.round(ratio*100)}%`,
                    detail: download_detail(download, names.length - pulled, names.length, ratio, time0),
                    ratio,
                };
            }
            return {text: `Unpacking ${image}`, detail: `${format_bytes(download.done)} in ${names.length} layers`, ratio: 1};
        },
    };
}

// How much of the image is here, counted in layers. **Not** in bytes: docker names a layer's
// size only when that layer starts downloading, three at a time, so a total made of sizes
// grows as the pull goes on — and a total that grows is a percentage that walks backwards and
// a number the person is right not to believe. Every layer is announced in the first moment,
// so their count is known from the start and never moves. A layer that is on its way counts
// for the fraction of itself that has arrived.
function part_done(layers)
{
    let out = 0;
    for (const name of Object.keys(layers)) {
        const layer = layers[name];
        if (layer.pulled) {
            out += 1;
            continue;
        }
        if (layer.total > 0) {
            out += Math.min(1, layer.done/layer.total);
        }
    }
    return out;
}

function layer_of(layers, name)
{
    if (layers[name] === undefined) {
        layers[name] = {done: 0, total: 0, pulled: false};
    }
    return layers[name];
}

function layer_step(layer, step, sizes)
{
    if ((step === 'Downloading') && (sizes !== null)) {
        layer.done = bytes_of(sizes[1]);
        layer.total = bytes_of(sizes[2]);
    }
    if ((step === 'Download complete') || (step === 'Already exists') || (step === 'Extracting') || (step === 'Pull complete')) {
        layer.done = layer.total;
    }
    if ((step === 'Pull complete') || (step === 'Already exists')) {
        layer.pulled = true;
    }
}

// What has arrived, in bytes. This is a count of the real thing — no total is made up from it,
// because docker has not said what the total is.
function count(layers, download)
{
    let done = 0;
    for (const name of Object.keys(layers)) {
        done += layers[name].done;
    }
    download.update(done);
}

// The numbers under the sentence: how many layers are left, how much has arrived, how fast,
// and how long that leaves. The time is worked out from the progress itself rather than from
// a size docker has not said — an estimate, and it says so with a `~`.
function download_detail(download, left, total, ratio, time0)
{
    const said = [`${left} of ${total} layers left`];
    if (download.done > 0) {
        said.push(`${format_bytes(download.done)} so far`);
    }
    if (download.rate > 0) {
        said.push(`${format_bytes(download.rate)}/s`);
    }
    if (ratio > 0.01) {
        said.push(`~${format_duration_ms((Date.now() - time0)*(1 - ratio)/ratio)} left`);
    }
    return said.join(' · ');
}

function bytes_of(text)
{
    const found = /^([0-9.]+)\s*([kKMGT]?i?B)$/.exec(String(text).trim());
    if (found === null) {
        return 0;
    }
    return Math.round(parseFloat(found[1])*(UNITS[found[2].replace('i', '').toLowerCase()] || 1));
}

module.exports = docker_pull_progress;
