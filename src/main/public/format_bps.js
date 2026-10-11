import format_bytes from './format_bytes.js';

function format_bps(bps)
{
    return ((bps === null) ? '~' : `${format_bytes(bps)}/s`);
}

export default format_bps;
