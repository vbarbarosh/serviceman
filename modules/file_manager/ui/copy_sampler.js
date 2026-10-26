// How often the speed is sampled, and over how long a span: a speed over the last three seconds
// is steady enough to read and still says when it drops
const SAMPLE_MS = 500;
const SAMPLE_SPAN_MS = 3000;

// The most points a graph keeps; past that, every other one goes
const SAMPLES_MAX = 400;

// The speed across a copy as it goes, for its graph: every half second, how fast the last three
// seconds went (y, bytes a second) at how far the copy has come (x, 0 to 1). A copy that goes
// back, files of a cut stream back in line, takes the graph back with it, never over itself.
// A pause samples nothing, and the speed after it is the speed after it.
//
//     read()   {done, total, paused}: bytes done and in all, now
//     out      the object whose samples it keeps: out.samples is replaced, never changed in place
//
// Answers with the function that stops it.
function copy_sampler(read, out)
{
    const seen = [];
    const timer = setInterval(function () {
        const now_read = read();
        if (now_read.paused === true) {
            seen.length = 0;
            return;
        }
        const now = Date.now();
        seen.push([now, now_read.done]);
        while ((seen.length > 1) && (now - seen[0][0] > SAMPLE_SPAN_MS)) {
            seen.shift();
        }
        if ((seen.length < 2) || (now_read.total === 0)) {
            return;
        }
        const speed = Math.max(0, (now_read.done - seen[0][1])*1000/(now - seen[0][0]));
        const x = Math.min(1, now_read.done/now_read.total);
        const samples = out.samples.filter(v => v.x <= x);
        samples.push({x, y: speed});
        out.samples = (samples.length > SAMPLES_MAX) ? samples.filter((v, index) => (index % 2 === 0)) : samples;
    }, SAMPLE_MS);
    return function () {
        clearInterval(timer);
    };
}

export default copy_sampler;
