const child_process = require('child_process');
const fs = require('fs');
const oval_critical_reader = require('./oval_critical_reader');
const path = require('path');
const readline = require('readline');
const stream = require('stream');

// How long a list read is taken as it is: Ubuntu writes its file about once a day, and asking
// whether it changed costs one request
const FRESH_MS = 60*60*1000;
// After a read that failed, how soon it is tried again
const RETRY_MS = 10*60*1000;
// What unpacks bzip2 here, tried in turn: Alpine has it as part of busybox
const UNPACKERS = [['bunzip2', ['-c']], ['bzip2', ['-dc']], ['busybox', ['bunzip2', '-c']]];
// One read of a release at a time, whoever asks
const reading = new Map();

// Canonical's CVE file of one release
function url_of(codename)
{
    return `https://security-metadata.canonical.com/oval/com.ubuntu.${codename}.cve.oval.xml.bz2`;
}

// The critical CVEs of one Ubuntu release (noble, jammy), as Canonical's CVE file says them,
// kept in a folder of the host's: read again once an hour if Canonical changed it since, and
// kept as it was when the read fails. Nothing about the machines is sent: the file is asked for
// whole.
//
//     options = {dir, codename, now, fetch, unpack}
//         dir      the folder it is kept in, made when missing
//         fetch    the global fetch, or one of a test's
//         unpack   (file) => a readable stream of the unpacked text; bunzip2 by default
//     out = {codename, url, checked_at, modified, generated, cves, error}
//         error: why the last read failed, or null; cves stays from the read before it
async function vulnerabilities_feed(options)
{
    const codename = options.codename;
    if (/^[a-z]+$/.test(codename || '') === false) {
        throw new Error(`no such Ubuntu release: ${codename}`);
    }
    const file = path.join(options.dir, `${codename}.json`);
    const kept = kept_read(file, codename);
    const now = (options.now === undefined) ? Date.now() : options.now;
    const wait = (kept.error === null) ? FRESH_MS : RETRY_MS;
    if ((kept.checked_at !== null) && (now - kept.checked_at < wait)) {
        return kept;
    }
    if (reading.has(file) === false) {
        reading.set(file, read(options, file, kept, now).finally(() => reading.delete(file)));
    }
    return await reading.get(file);
}

// What is kept of a release, or an empty one never read
function kept_read(file, codename)
{
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return {codename, url: url_of(codename), checked_at: null, modified: null, generated: null, cves: null, error: null};
    }
}

async function read(options, file, kept, now)
{
    const out = Object.assign({}, kept, {checked_at: now});
    const packed = `${file}.${process.pid}.bz2`;
    try {
        const headers = (kept.modified === null) ? {} : {'if-modified-since': kept.modified};
        const answer = await (options.fetch || fetch)(kept.url, {headers, signal: AbortSignal.timeout(5*60*1000)});
        if ((answer.status === 304) && (kept.cves !== null)) {
            out.error = null;
        }
        else if (answer.status === 304) {
            out.error = `${kept.url} answered 304 with nothing kept here`;
        }
        else if (answer.status === 404) {
            out.error = `Ubuntu publishes no CVE file for ${kept.codename}`;
        }
        else if (answer.ok === false) {
            out.error = `${kept.url} answered ${answer.status}`;
        }
        else {
            fs.mkdirSync(options.dir, {recursive: true});
            fs.writeFileSync(packed, Buffer.from(await answer.arrayBuffer()));
            const found = await lines_read((options.unpack || unpack)(packed));
            Object.assign(out, {modified: answer.headers.get('last-modified'), generated: found.generated, cves: found.cves, error: null});
        }
    }
    catch (error) {
        out.error = `Ubuntu's CVE file of ${kept.codename} could not be read: ${error.message}`;
    }
    finally {
        fs.rmSync(packed, {force: true});
    }
    fs.mkdirSync(options.dir, {recursive: true});
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(out));
    fs.renameSync(temp, file);
    return out;
}

// The unpacked file, a line at a time, into the reader
async function lines_read(stream)
{
    const reader = oval_critical_reader();
    const lines = readline.createInterface({input: stream, crlfDelay: Infinity});
    for await (const line of lines) {
        reader.line(line);
    }
    const out = reader.end();
    if (out.generated === null) {
        throw new Error('it is not an OVAL file: no timestamp in it');
    }
    return out;
}

// bunzip2 over the file, the first of them this machine has; one that fails says why
function unpack(file)
{
    const out = new stream.PassThrough();
    try_one(0);
    return out;

    function try_one(i) {
        if (i >= UNPACKERS.length) {
            out.destroy(new Error('nothing here unpacks bzip2: bunzip2, bzip2 or busybox'));
            return;
        }
        const [command, args] = UNPACKERS[i];
        const child = child_process.spawn(command, args, {stdio: ['pipe', 'pipe', 'pipe']});
        let started = false;
        let said = '';
        child.on('spawn', function () {
            started = true;
            fs.createReadStream(file).on('error', e => out.destroy(e)).pipe(child.stdin);
            child.stdout.pipe(out, {end: false});
        });
        child.stdin.on('error', () => {});
        child.stderr.on('data', v => said = (said + v).slice(-500));
        child.on('error', function (error) {
            if ((started === false) && (error.code === 'ENOENT')) {
                try_one(i + 1);
                return;
            }
            out.destroy(error);
        });
        // close comes once its output has ended, so all of it is in out by then
        child.on('close', function (code) {
            if (started === false) {
                return;
            }
            if (code === 0) {
                out.end();
                return;
            }
            out.destroy(new Error(`${command} failed: ${said.trim() || `exit ${code}`}`));
        });
    }
}

vulnerabilities_feed.url_of = url_of;

module.exports = vulnerabilities_feed;
