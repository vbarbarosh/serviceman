const crypto = require('crypto');
const net = require('net');

// How long the authority and the certificate it signs stand: a server's public port keeps them
// until it is taken away, and a client has the authority's file
const YEARS = 10;
// An hour's leeway for a client whose clock is behind
const BACKDATE_MS = 60*60*1000;
const OID = {
    common_name: '2.5.4.3',
    ecdsa_sha256: '1.2.840.10045.4.3.2',
    basic_constraints: '2.5.29.19',
    key_usage: '2.5.29.15',
    ext_key_usage: '2.5.29.37',
    server_auth: '1.3.6.1.5.5.7.3.1',
    subject_alt_name: '2.5.29.17',
    subject_key_id: '2.5.29.14',
    authority_key_id: '2.5.29.35',
};

// An authority of its own and a server certificate it signs, for TLS on a port serviceman opens:
// a client trusts the authority's file (a MongoDB's tlsCAFile), and the certificate names the
// addresses and names it is reached at, so the client checks it is talking to that server.
// EC P-256 keys, signed with ECDSA and SHA-256, ten years each.
//
//     name       what the certificates are called, their common name: 'mongodb-1'
//     at         the addresses and host names it is reached at: ['203.0.113.5', 'db.example.com']
//
// Answers {ca, cert, key}, PEM: the authority's certificate, the server's followed by the
// authority's (the chain it presents), and the server's private key. The authority's key is
// thrown away: nothing else is ever signed with it.
//
//     tls_cert_make('mongodb-1', ['203.0.113.5'])
function tls_cert_make(name, at)
{
    const now = Date.now();
    const validity = [new Date(now - BACKDATE_MS), new Date(now + YEARS*365.25*24*60*60*1000)];
    const authority = crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'});
    const server = crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'});
    const authority_spki = authority.publicKey.export({type: 'spki', format: 'der'});
    const server_spki = server.publicKey.export({type: 'spki', format: 'der'});
    const authority_name = name_der(`${name} authority`);
    const authority_id = key_id(authority_spki);
    const ca = signed({
        issuer: authority_name,
        subject: authority_name,
        spki: authority_spki,
        validity,
        key: authority.privateKey,
        extensions: [
            extension(OID.basic_constraints, true, seq(bool(true))),
            // keyCertSign and cRLSign
            extension(OID.key_usage, true, tlv(0x03, Buffer.from([0x01, 0x06]))),
            extension(OID.subject_key_id, false, tlv(0x04, authority_id)),
        ],
    });
    const cert = signed({
        issuer: authority_name,
        subject: name_der(name),
        spki: server_spki,
        validity,
        key: authority.privateKey,
        extensions: [
            extension(OID.basic_constraints, true, seq()),
            // digitalSignature
            extension(OID.key_usage, true, tlv(0x03, Buffer.from([0x07, 0x80]))),
            extension(OID.ext_key_usage, false, seq(oid(OID.server_auth))),
            extension(OID.subject_alt_name, false, seq(...at.map(alt_name))),
            extension(OID.subject_key_id, false, tlv(0x04, key_id(server_spki))),
            extension(OID.authority_key_id, false, seq(tlv(0x80, authority_id))),
        ],
    });
    return {ca: pem(ca), cert: pem(cert) + pem(ca), key: server.privateKey.export({type: 'pkcs8', format: 'pem'})};
}

// A certificate: its body signed by the issuer's key
function signed(v)
{
    const algorithm = seq(oid(OID.ecdsa_sha256));
    const body = seq(
        tlv(0xa0, integer(Buffer.from([2]))),
        integer(serial()),
        algorithm,
        v.issuer,
        seq(time(v.validity[0]), time(v.validity[1])),
        v.subject,
        v.spki,
        tlv(0xa3, seq(...v.extensions)),
    );
    const signature = crypto.sign('sha256', body, v.key);
    return seq(body, algorithm, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
}

function extension(id, critical, value)
{
    return critical ? seq(oid(id), bool(true), tlv(0x04, value)) : seq(oid(id), tlv(0x04, value));
}

// An address as an IP address, anything else as a host name
function alt_name(v)
{
    if (net.isIPv4(v)) {
        return tlv(0x87, Buffer.from(v.split('.').map(Number)));
    }
    if (net.isIPv6(v)) {
        return tlv(0x87, ipv6_bytes(v));
    }
    return tlv(0x82, Buffer.from(v, 'ascii'));
}

function ipv6_bytes(v)
{
    const halves = v.split('::');
    const head = (halves[0] === '') ? [] : halves[0].split(':');
    const tail = ((halves.length < 2) || (halves[1] === '')) ? [] : halves[1].split(':');
    const groups = head.concat(new Array(8 - head.length - tail.length).fill('0'), tail);
    return Buffer.concat(groups.map(vv => Buffer.from(vv.padStart(4, '0'), 'hex')));
}

function name_der(common_name)
{
    return seq(tlv(0x31, seq(oid(OID.common_name), tlv(0x0c, Buffer.from(common_name, 'utf8')))));
}

// What tells one key from another in a chain: the SHA-1 of its public key, as RFC 5280 suggests
function key_id(spki)
{
    return crypto.createHash('sha1').update(spki).digest();
}

// 16 random bytes, positive
function serial()
{
    const out = crypto.randomBytes(16);
    out[0] &= 0x7f;
    return out;
}

// UTCTime up to 2049, GeneralizedTime from 2050, as RFC 5280 asks
function time(date)
{
    const text = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
    if (date.getUTCFullYear() < 2050) {
        return tlv(0x17, Buffer.from(text.slice(2), 'ascii'));
    }
    return tlv(0x18, Buffer.from(text, 'ascii'));
}

function oid(text)
{
    const parts = text.split('.').map(Number);
    const bytes = [40*parts[0] + parts[1]];
    for (const part of parts.slice(2)) {
        const chunk = [part & 0x7f];
        for (let rest = part >> 7; rest > 0; rest >>= 7) {
            chunk.unshift((rest & 0x7f) | 0x80);
        }
        bytes.push(...chunk);
    }
    return tlv(0x06, Buffer.from(bytes));
}

function integer(bytes)
{
    return tlv(0x02, ((bytes[0] & 0x80) === 0) ? bytes : Buffer.concat([Buffer.from([0]), bytes]));
}

function bool(value)
{
    return tlv(0x01, Buffer.from([value ? 0xff : 0]));
}

function seq(...items)
{
    return tlv(0x30, Buffer.concat(items));
}

// A DER tag, its length, its content
function tlv(tag, content)
{
    const length = content.length;
    if (length < 0x80) {
        return Buffer.concat([Buffer.from([tag, length]), content]);
    }
    const bytes = [];
    for (let rest = length; rest > 0; rest >>= 8) {
        bytes.unshift(rest & 0xff);
    }
    return Buffer.concat([Buffer.from([tag, 0x80 | bytes.length, ...bytes]), content]);
}

function pem(der)
{
    const lines = der.toString('base64').match(/.{1,64}/g);
    return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

module.exports = tls_cert_make;
