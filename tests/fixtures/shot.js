#!/usr/bin/env node

// A screen, as a png of the size a screen is: what a machine's capture line hands back in the
// tests. It is drawn here rather than kept as a file, because a picture in a repo is a picture
// somebody has to open to know what it is.
const cli = require('@vbarbarosh/node-helpers/src/cli');
const fs = require('fs');
const zlib = require('zlib');

// A picture of a screen, or a screenful of nothing — which is what a machine whose screen is
// asleep hands back, at the full size of that screen
const BLANK = process.argv.includes('--blank');
const WIDTH = (BLANK ? 1920 : 240);
const HEIGHT = (BLANK ? 1080 : 160);

cli(main);

function main()
{
    fs.writeFileSync(process.argv[2], png());
}

function png()
{
    const head = Buffer.alloc(13);
    head.writeUInt32BE(WIDTH, 0);
    head.writeUInt32BE(HEIGHT, 4);
    // Eight bits a channel, three channels
    head[8] = 8;
    head[9] = 2;
    const rows = Buffer.alloc(HEIGHT*(1 + WIDTH*3));
    for (let y = 0; (y < HEIGHT) && (BLANK === false); y++) {
        for (let x = 0; x < WIDTH; x++) {
            const at = y*(1 + WIDTH*3) + 1 + x*3;
            rows[at] = x % 256;
            rows[at + 1] = y % 256;
            rows[at + 2] = 90;
        }
    }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', head),
        chunk('IDAT', zlib.deflateSync(rows)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function chunk(type, data)
{
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
    return out;
}

function crc32(buf)
{
    let crc = 0xffffffff;
    for (const byte of buf) {
        let c = (crc ^ byte) & 0xff;
        for (let j = 0; j < 8; j++) {
            c = ((c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1);
        }
        crc = c ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
