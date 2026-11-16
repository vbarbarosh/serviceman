const assert = require('assert');

const FX_OK = 0;
const FX_EOF = 1;
const PFLAG_READ = 0x1;
const PFLAG_WRITE = 0x2;
const PFLAG_CREAT = 0x8;
const PFLAG_TRUNC = 0x10;

// The few requests of SFTP 3 the tests send, over any stream that speaks it, and the answers
// read back by request id
async function sftp_client(server)
{
    const pending = new Map();
    let input = Buffer.alloc(0);
    let next_id = 0;
    let version = null;
    server.on('data', function (chunk) {
        input = Buffer.concat([input, chunk]);
        while ((input.length >= 4) && (input.length >= 4 + input.readUInt32BE(0))) {
            const body = input.subarray(4, 4 + input.readUInt32BE(0));
            input = input.subarray(4 + body.length);
            if (body[0] === 2) {
                version(body.readUInt32BE(1));
                continue;
            }
            const id = body.readUInt32BE(1);
            pending.get(id)(answer_read(body));
            pending.delete(id);
        }
    });
    const ready = new Promise(function (resolve) {
        version = resolve;
    });
    server.write(packet(1, [u32(3)]));
    assert.strictEqual(await ready, 3);
    return {
        ask: function (type, parts) {
            next_id++;
            const id = next_id;
            return new Promise(function (resolve) {
                pending.set(id, resolve);
                server.write(packet(type, [u32(id)].concat(parts)));
            });
        },
        realpath: async function (name) {
            return (await this.ask(16, [str(name)])).names[0];
        },
        stat: async function (name) {
            return (await this.ask(17, [str(name)])).attrs;
        },
        names: async function (name) {
            const handle = (await this.ask(11, [str(name)])).handle;
            const names = [];
            for (;;) {
                const answer = await this.ask(12, [str(handle)]);
                if (answer.code === FX_EOF) {
                    break;
                }
                names.push(...answer.names);
            }
            await this.ask(4, [str(handle)]);
            return names.sort();
        },
        open: function (name, pflags) {
            return this.ask(3, [str(name), u32(pflags), u32(0)]);
        },
        read_file: async function (name) {
            const handle = (await this.open(name, PFLAG_READ)).handle;
            const parts = [];
            for (;;) {
                const answer = await this.ask(5, [str(handle), u64(parts.reduce((a, v) => a + v.length, 0)), u32(32768)]);
                if (answer.code === FX_EOF) {
                    break;
                }
                parts.push(answer.data);
            }
            await this.ask(4, [str(handle)]);
            return Buffer.concat(parts).toString();
        },
        write_file: async function (name, text) {
            const opened = await this.open(name, PFLAG_WRITE | PFLAG_CREAT | PFLAG_TRUNC);
            if (opened.handle === undefined) {
                return opened;
            }
            const written = await this.ask(6, [str(opened.handle), u64(0), str(text)]);
            await this.ask(4, [str(opened.handle)]);
            return written;
        },
    };
}

function answer_read(body)
{
    const type = body[0];
    let at = 5;
    function uint32() {
        at += 4;
        return body.readUInt32BE(at - 4);
    }
    function string() {
        const length = uint32();
        at += length;
        return body.subarray(at - length, at);
    }
    if (type === 101) {
        return {code: uint32(), message: string().toString()};
    }
    if (type === 102) {
        return {code: FX_OK, handle: string()};
    }
    if (type === 103) {
        return {code: FX_OK, data: string()};
    }
    if (type === 104) {
        const count = uint32();
        const names = [];
        for (let i = 0; i < count; i++) {
            names.push(string().toString());
            string();
            const flags = uint32();
            at += (((flags & 0x1) !== 0) ? 8 : 0) + (((flags & 0x2) !== 0) ? 8 : 0) + (((flags & 0x4) !== 0) ? 4 : 0) + (((flags & 0x8) !== 0) ? 8 : 0);
        }
        return {code: FX_OK, names};
    }
    if (type === 105) {
        uint32();
        return {code: FX_OK, attrs: {size: Number(body.readBigUInt64BE(at))}};
    }
    throw new Error(`answer ${type}`);
}

function packet(type, parts)
{
    const body = Buffer.concat([Buffer.from([type])].concat(parts));
    return Buffer.concat([u32(body.length), body]);
}

function u32(value)
{
    const out = Buffer.alloc(4);
    out.writeUInt32BE(value);
    return out;
}

function u64(value)
{
    const out = Buffer.alloc(8);
    out.writeBigUInt64BE(BigInt(value));
    return out;
}

function str(value)
{
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return Buffer.concat([u32(bytes.length), bytes]);
}

sftp_client.u32 = u32;
sftp_client.u64 = u64;
sftp_client.str = str;

module.exports = sftp_client;
