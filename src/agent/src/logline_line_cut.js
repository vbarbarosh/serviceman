const LINE_BYTES = 64*1024;

// A line over 64K is cut the rules' way — on a character, never inside one, and ending with
// the bytes left out — so one runaway line cannot outgrow a batch
function logline_line_cut(line)
{
    const bytes = Buffer.from(line);
    if (bytes.length <= LINE_BYTES) {
        return line;
    }
    let end = LINE_BYTES - 32;
    // Back off to the start of a character: continuation bytes are 10xxxxxx
    while ((end > 0) && ((bytes[end] & 0xc0) === 0x80)) {
        end -= 1;
    }
    return `${bytes.subarray(0, end).toString('utf8')}...+${bytes.length - end}`;
}

module.exports = logline_line_cut;
