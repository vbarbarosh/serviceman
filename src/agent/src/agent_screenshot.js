const agent_shell = require('./agent_shell');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Nothing this small is a screen; a picture under it is an empty window somebody grabbed
const SMALLEST_SCREEN = 100;
// A picture of a screen carries detail, and detail does not compress to nothing. A screenful
// of one colour comes back at a few thousand bytes a megapixel; a real one, even a dark one
// with a single terminal on it, is tens of thousands. Anything under this is not a picture of
// anything: a screen that is off or locked, or a way in that cannot see what is drawn.
const A_SCREENFUL = 250000;
const FLAT_UNDER_BYTES_PER_MP = 4000;

// How long one way in may take before it is stopped, and how long the whole question may take.
// A screenshot is a fast thing or it is nothing: a tool that sits there is waiting for
// somebody to click something, and there is nobody at this end to click it. The host gives up
// at thirty seconds, so everything here has to be over before that with room to say so.
const EACH_MS = 6000;
const ALL_MS = 20000;

// Wayland keeps moving the door: every GNOME release allows a different caller, and none of
// them is everywhere. So the ways in are tried in order, and when none works the answer names
// what each one said — pressed on a machine, the button is how you find out what that machine
// allows. A --screenshot line of your own goes first and alone.
function candidates(options, file)
{
    if (options.screenshot !== '') {
        return [{method: 'the --screenshot line', argv: ['/bin/sh', '-c', options.screenshot.split('%f').join(file)]}];
    }
    return [
        {method: 'gnome-screenshot', argv: ['gnome-screenshot', '-f', file]},
        // With a deadline of its own: a dbus call whose far end never answers waits out dbus's
        // own minute, and this whole question is worth seconds
        {method: 'gnome-shell over dbus', argv: ['gdbus', 'call', '--timeout', String(Math.round(EACH_MS/1000)), '--session', '--dest', 'org.gnome.Shell.Screenshot', '--object-path', '/org/gnome/Shell/Screenshot', '--method', 'org.gnome.Shell.Screenshot.Screenshot', 'false', 'false', file]},
        {method: 'grim', argv: ['grim', file]},
        // `-screen` is the whole difference on a composited X11 desktop: without it, what is
        // grabbed is the root window's own contents, and a compositor draws nothing there —
        // the answer is the right size and one flat colour
        {method: 'import', argv: ['import', '-screen', '-window', 'root', file]},
    ];
}

// What is on the machine's screen, as one png. The agent lives in the user's session, so it
// may ask; a session variable a user unit was not given is filled with the usual value.
async function agent_screenshot(options)
{
    const file = where(process.pid);
    const env = Object.assign({}, process.env, {
        WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-0',
        DISPLAY: process.env.DISPLAY || ':0',
    });
    const tried = [];
    const until = Date.now() + ALL_MS;
    for (const item of candidates(options, file)) {
        if (Date.now() >= until) {
            tried.push(`${item.method}: not asked — the ones before it took the time there was`);
            continue;
        }
        // Every way in is given a few seconds and then stopped. A screenshot tool that waits is
        // one that has opened a window on that screen and is waiting for a person to click it:
        // there is nobody there, and leaving it up would be leaving a window on somebody's
        // desktop for the sake of a picture nobody got.
        const answer = await agent_shell(item.argv, {env, timeout: EACH_MS, killSignal: 'SIGKILL'});
        const png = png_read(file);
        const size = ((png === null) ? null : png_size(png));
        if (answer.ok && (size !== null) && big_enough(size) && (flat(size, png) === false)) {
            return {ok: true, method: item.method, bytes: png.length, width: size.width, height: size.height, png: png.toString('base64')};
        }
        // A command that wrote a picture the size of a postage stamp did not take a picture of
        // the screen. `import` on a wayland session does exactly that: the X root window it
        // grabs has nothing in it, and a blank answer counted as success is worse than none.
        tried.push(`${item.method}: ${why(answer, size, file)}`.trim());
    }
    return {ok: false, tried, stderr: tried.join(' · ')};
}

// Where the picture is written. Not /tmp: a screenshot tool installed as a snap has a /tmp of
// its own, so it writes a file that is real over there and missing here — which looks exactly
// like a tool that did nothing. A folder under the person's home is one both ends can see.
function where(pid)
{
    const home = process.env.HOME;
    if ((home === undefined) || (home === '')) {
        return path.join(os.tmpdir(), `serviceman-shot-${pid}.png`);
    }
    const dir = path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'serviceman');
    try {
        fs.mkdirSync(dir, {recursive: true});
        return path.join(dir, `shot-${pid}.png`);
    }
    catch {
        return path.join(os.tmpdir(), `serviceman-shot-${pid}.png`);
    }
}

// Why this way in did not give a picture, in the words of whatever refused. A command that
// says nothing at all still says how it ended, and whether anything appeared where it was
// told to write — which is the difference between a tool that failed and one confined
// somewhere this end cannot see.
function why(answer, size, file)
{
    if (answer.killed) {
        return `waited longer than ${Math.round(EACH_MS/1000)}s and was stopped — it wants somebody at that machine to click something`;
    }
    if ((size !== null) && (big_enough(size) === false)) {
        return `wrote a ${size.width}×${size.height} picture, which is not this screen`;
    }
    if (size !== null) {
        return `wrote a ${size.width}×${size.height} picture of one flat colour — the screen is off or locked, or this way in cannot see what is drawn`;
    }
    const out = (answer.stderr || answer.stdout || '').trim();
    if (out !== '') {
        return out;
    }
    return `ended ${answer.code} and wrote no file at ${file}`;
}

function big_enough(size)
{
    return (size.width >= SMALLEST_SCREEN) && (size.height >= SMALLEST_SCREEN);
}

// Whether the picture is all one colour, judged by how small it came out for its size — no
// decoding, because a png of a real screen never compresses this far
function flat(size, png)
{
    const pixels = size.width*size.height;
    return (pixels >= A_SCREENFUL) && (png.length*1000000/pixels < FLAT_UNDER_BYTES_PER_MP);
}

// How wide and tall the png says it is: the first chunk of the file, always, and it is there
// before any of the pixels
function png_size(png)
{
    if ((png.length < 24) || (png.toString('ascii', 12, 16) !== 'IHDR')) {
        return null;
    }
    return {width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
}

function png_read(file)
{
    try {
        const png = fs.readFileSync(file);
        fs.unlinkSync(file);
        return ((png.length === 0) ? null : png);
    }
    catch {
        return null;
    }
}

module.exports = agent_screenshot;
