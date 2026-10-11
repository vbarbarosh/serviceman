const time_utc = require('./time_utc');

const LABEL_BYTES = 1024;

// What POST /lines was sent -> the items to store, or an error that says which item is wrong
// and how. One wrong item refuses the whole batch: a batch is stored whole or not at all, so a
// sender never has to find out which half of it went in.
//
// Labels are an object, {"host": "server.example.com", "service": "ffmpeg"}. The list they were at
// first, [{name, value}], is still taken — a machine may hold batches cut before the change —
// and read as the same object.
function lines_from_json(json)
{
    if (Array.isArray(json) === false) {
        throw new Error('expected an array of {time, labels, line}');
    }
    const out = [];
    for (let i = 0; i < json.length; i++) {
        const item = json[i];
        const label = `[${i}]`;
        if ((item === null) || (typeof item !== 'object') || Array.isArray(item)) {
            throw new Error(`${label}: expected {time, labels, line}`);
        }
        const time = time_utc(item.time);
        if (time === null) {
            throw new Error(`${label}.time: expected an ISO time, such as 2026-09-25T18:17:09.979Z (got ${JSON.stringify(item.time)})`);
        }
        if (typeof item.line !== 'string') {
            throw new Error(`${label}.line: expected a string`);
        }
        out.push({time, labels: labels_from_json(item.labels, `${label}.labels`), line: item.line});
    }
    return out;
}

function labels_from_json(json, label)
{
    const pairs = [];
    if (Array.isArray(json)) {
        for (let i = 0; i < json.length; i++) {
            const item = json[i];
            if ((item === null) || (typeof item !== 'object')) {
                throw new Error(`${label}[${i}]: expected {name, value}`);
            }
            pairs.push([item.name, item.value, `${label}[${i}]`]);
        }
    }
    else if ((json !== null) && (typeof json === 'object')) {
        for (const name of Object.keys(json)) {
            pairs.push([name, json[name], `${label}.${name}`]);
        }
    }
    else {
        throw new Error(`${label}: expected an object of names and values, {"host": "server.example.com"}`);
    }
    const out = {};
    for (const [name, value, where] of pairs) {
        if ((typeof name !== 'string') || (name === '') || (typeof value !== 'string')) {
            throw new Error(`${where}: a label is a name and a value, both strings, the name not empty`);
        }
        if (Buffer.byteLength(name) + Buffer.byteLength(value) > LABEL_BYTES) {
            throw new Error(`${where}: a label is kept under ${LABEL_BYTES} bytes`);
        }
        out[name] = value;
    }
    return out;
}

module.exports = lines_from_json;
