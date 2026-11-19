const crypto = require('crypto');
const database_samples = require('./database_samples');
const fs = require('fs');
const path = require('path');

// How long one fetch of a sample's file may take
const FETCH_TIMEOUT_MS = 120000;

// A sample's SQL files, in the order they load: [{name, bytes}]. Each fetched once into
// data/samples/, named by its sha256, and taken only when its sha256 is the pinned one; a fetch
// that is anything else is refused, and nothing is kept of it.
async function database_sample_files(app, engine, name)
{
    const sample = (database_samples[engine] === undefined) ? undefined : database_samples[engine][name];
    if (sample === undefined) {
        throw new Error(`no sample called ${JSON.stringify(name)} for ${engine}`);
    }
    const out = [];
    for (const item of sample.files) {
        const file = path.resolve(app.state_dir, 'samples', `${item.sha256}.sql`);
        let bytes;
        try {
            bytes = fs.readFileSync(file);
        }
        catch {
            bytes = await fetched(sample, item);
            fs.mkdirSync(path.dirname(file), {recursive: true});
            fs.writeFileSync(`${file}.new`, bytes);
            fs.renameSync(`${file}.new`, file);
        }
        if (sha256_of(bytes) !== item.sha256) {
            throw new Error(`${sample.label}'s ${path.basename(item.url)} kept in ${file} is not the one pinned: remove it and try again`);
        }
        out.push({name: path.basename(item.url), bytes});
    }
    return out;
}

async function fetched(sample, item)
{
    let answer;
    try {
        answer = await fetch(item.url, {signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)});
    }
    catch (error) {
        throw new Error(`${sample.label} could not be fetched from ${item.url}: ${error.message}`);
    }
    if (answer.ok === false) {
        throw new Error(`${sample.label} could not be fetched from ${item.url}: ${answer.status}`);
    }
    const bytes = Buffer.from(await answer.arrayBuffer());
    const sum = sha256_of(bytes);
    if (sum !== item.sha256) {
        throw new Error(`${sample.label} at ${item.url} is not the one pinned: its sha256 is ${sum}, not ${item.sha256}`);
    }
    return bytes;
}

function sha256_of(bytes)
{
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

module.exports = database_sample_files;
