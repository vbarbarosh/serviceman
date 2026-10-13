// A long name or a pax header is held whole in memory; past this it is no name but a flood
const META_MAX_BYTES = 1024*1024;
const BLOCK = 512;

// A tar read as its bytes come, in chunks cut anywhere: a header may end in the next chunk, and
// a file's bytes run across as many as they like. push(chunk) answers what the chunk finished:
//
//     {type: 'dir', name}                  a folder
//     {type: 'file', name, size, mtime_s}  a file begins, its time in seconds as the header
//                                          says; its bytes follow as data, then file_end
//     {type: 'data', bytes}                some bytes of the file, a slice of the chunk
//     {type: 'file_end'}
//     {type: 'other', name}                a link, a device, anything else, its data read past;
//                                          name null for pax's settings for the whole tar
//
// A name is ustar's (its prefix, a slash, its name), a GNU long name (././@LongLink, type L)
// or a pax path; it comes back relative, `/`-separated, without `.` parts. A name that is
// absolute or walks out with `..` is refused, as is a header whose checksum does not add up:
// push throws, with error.code ETARNAME or ETARHEADER, error.entries the entries read before
// and error.at where in the chunk the header began (0 when it began in one before), and the tar
// is read no further. end() says whether the tar ended where it should, after its end block:
// null, or an error ETARCUT.
function tar_parser()
{
    const state = {mode: 'header', held: [], held_bytes: 0, header_at: 0, left: 0, skip: 0, meta: null, long_name: null, pax: null, meta_bytes: 0, entries: 0};
    return {
        push: function (chunk) {
            return chunk_read(state, chunk);
        },
        end: function () {
            if (state.mode === 'done') {
                return null;
            }
            return tar_error('ETARCUT', 'the tar was cut before its end');
        },
    };
}

function chunk_read(state, chunk)
{
    const out = [];
    let at = 0;
    state.header_at = 0;
    while ((at < chunk.length) && (state.mode !== 'done')) {
        if (state.mode === 'skip') {
            const n = Math.min(state.skip, chunk.length - at);
            state.skip -= n;
            at += n;
            if (state.skip === 0) {
                state.mode = 'header';
            }
            continue;
        }
        if (state.mode === 'data') {
            const n = Math.min(state.left, chunk.length - at);
            out.push({type: 'data', bytes: chunk.subarray(at, at + n)});
            state.left -= n;
            at += n;
            if (state.left === 0) {
                out.push({type: 'file_end'});
                skip_to_block(state, state.size);
            }
            continue;
        }
        if (state.mode === 'meta') {
            const n = Math.min(state.left, chunk.length - at);
            state.meta.push(chunk.subarray(at, at + n));
            state.left -= n;
            at += n;
            if (state.left === 0) {
                meta_read(state);
                skip_to_block(state, state.size);
            }
            continue;
        }
        if (state.held_bytes === 0) {
            state.header_at = at;
        }
        const n = Math.min(BLOCK - state.held_bytes, chunk.length - at);
        state.held.push(chunk.subarray(at, at + n));
        state.held_bytes += n;
        at += n;
        if (state.held_bytes === BLOCK) {
            const block = Buffer.concat(state.held);
            state.held = [];
            state.held_bytes = 0;
            try {
                header_read(state, block, out);
            }
            catch (error) {
                error.entries = state.entries;
                error.at = state.header_at;
                throw error;
            }
        }
    }
    return out;
}

// Past the zeros that pad an entry's data to a whole block
function skip_to_block(state, size)
{
    state.skip = (BLOCK - size % BLOCK) % BLOCK;
    state.mode = ((state.skip === 0) ? 'header' : 'skip');
}

function header_read(state, block, out)
{
    if (block.every(v => (v === 0))) {
        // The end of the tar; whatever pads it after is not read
        state.mode = 'done';
        return;
    }
    if (number_read(block, 148, 8) !== checksum_of(block)) {
        throw tar_error('ETARHEADER', 'the body is not a tar: a header\'s checksum does not add up');
    }
    const type = String.fromCharCode(block[156]);
    const pax = ((state.pax === null) ? {} : state.pax);
    const own_size = number_read(block, 124, 12);
    if ((type === 'L') || (type === 'x')) {
        state.size = own_size;
        state.meta_bytes += own_size;
        if (state.meta_bytes > META_MAX_BYTES) {
            throw tar_error('ETARHEADER', `the tar names one entry with more than ${META_MAX_BYTES} bytes of headers`);
        }
        state.meta_type = type;
        state.meta = [];
        state.left = own_size;
        if (own_size === 0) {
            meta_read(state);
            return;
        }
        state.mode = 'meta';
        return;
    }
    if (type === 'g') {
        // Settings for the whole tar, none of which a file here takes
        out.push({type: 'other', name: null});
        skip_data(state, own_size);
        return;
    }
    const size = ((pax.size === undefined) ? own_size : pax.size);
    const mtime_s = ((pax.mtime === undefined) ? number_read(block, 136, 12) : pax.mtime);
    state.size = size;
    const name = name_checked(name_of(state, block, pax));
    state.long_name = null;
    state.pax = null;
    state.meta_bytes = 0;
    if ((type === '0') || (type === '\0')) {
        if (name === '') {
            throw tar_error('ETARNAME', 'a file in the tar has no name');
        }
        state.entries++;
        out.push({type: 'file', name, size, mtime_s});
        if (size === 0) {
            out.push({type: 'file_end'});
            return;
        }
        state.left = size;
        state.mode = 'data';
        return;
    }
    if (type === '5') {
        // `.` is the folder the tar is sent to, which is there
        if (name !== '') {
            state.entries++;
            out.push({type: 'dir', name});
        }
    }
    else {
        state.entries++;
        out.push({type: 'other', name});
    }
    skip_data(state, size);
}

function skip_data(state, size)
{
    state.skip = Math.ceil(size/BLOCK)*BLOCK;
    state.mode = ((state.skip === 0) ? 'header' : 'skip');
}

// A long name, or a pax header's path, size and time, for the entry that comes next
function meta_read(state)
{
    const bytes = Buffer.concat(state.meta);
    state.meta = null;
    if (state.meta_type === 'L') {
        const end = bytes.indexOf(0);
        state.long_name = bytes.subarray(0, ((end === -1) ? bytes.length : end)).toString('utf8');
        return;
    }
    // Records of "<length> <key>=<value>\n"
    const pax = ((state.pax === null) ? {} : state.pax);
    let at = 0;
    while (at < bytes.length) {
        const space = bytes.indexOf(0x20, at);
        const length = parseInt(bytes.subarray(at, space).toString('latin1'), 10);
        if ((space === -1) || (Number.isInteger(length) === false) || (length <= 0)) {
            break;
        }
        const record = bytes.subarray(space + 1, at + length - 1).toString('utf8');
        const equals = record.indexOf('=');
        const key = record.slice(0, equals);
        if (key === 'path') {
            pax.path = record.slice(equals + 1);
        }
        if (key === 'size') {
            pax.size = Number(record.slice(equals + 1));
        }
        if (key === 'mtime') {
            // Seconds, with a fraction when the writer kept one
            pax.mtime = Number(record.slice(equals + 1));
        }
        at += length;
    }
    state.pax = pax;
}

function name_of(state, block, pax)
{
    if (state.long_name !== null) {
        return state.long_name;
    }
    if (pax.path !== undefined) {
        return pax.path;
    }
    const name = text_read(block, 0, 100);
    const prefix = ((block.subarray(257, 262).toString('latin1') === 'ustar') ? text_read(block, 345, 155) : '');
    return ((prefix === '') ? name : `${prefix}/${name}`);
}

// A name under the folder the tar is sent to, or the refusal
function name_checked(text)
{
    if (text.startsWith('/')) {
        throw tar_error('ETARNAME', `${JSON.stringify(text)} is an absolute name, and a tar's names are under the folder it is sent to`);
    }
    const parts = text.split('/').filter(v => ((v !== '') && (v !== '.')));
    if (parts.includes('..')) {
        throw tar_error('ETARNAME', `${JSON.stringify(text)} walks out of the folder the tar is sent to`);
    }
    return parts.join('/');
}

function text_read(block, start, length)
{
    const field = block.subarray(start, start + length);
    const end = field.indexOf(0);
    return field.subarray(0, ((end === -1) ? field.length : end)).toString('utf8');
}

// A number field: octal digits, or GNU's base-256 for a size past 8 GB (its first bit set)
function number_read(block, start, length)
{
    if ((block[start] & 0x80) !== 0) {
        let out = block[start] & 0x7f;
        for (let i = start + 1; i < start + length; i++) {
            out = out*256 + block[i];
        }
        return out;
    }
    const text = block.subarray(start, start + length).toString('latin1').replace(/[\0 ]/g, '');
    return ((text === '') ? 0 : parseInt(text, 8));
}

// The sum of a header's bytes, its checksum field counted as spaces
function checksum_of(block)
{
    let out = 0;
    for (let i = 0; i < BLOCK; i++) {
        out += (((i >= 148) && (i < 156)) ? 0x20 : block[i]);
    }
    return out;
}

function tar_error(code, message)
{
    const out = new Error(message);
    out.code = code;
    return out;
}

module.exports = tar_parser;
