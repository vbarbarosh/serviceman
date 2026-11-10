import secret_write from './secret_write.js';

// What a service's rows of secrets say, asked of the door one by one: a kept one taken away, a
// value typed here, a copy asked for from the library. The first one the door refuses, or does
// not answer, stops it there and is what comes back, in words: its row stays as it was typed,
// and so do the rows after it. A row the door has is marked kept, its boxes emptied and its
// length the door's. null says the door has them all.
async function secret_rows_write(service, rows, gone)
{
    // Taken away first: a name taken away and typed again in the same card is the new one
    while (gone.length > 0) {
        const said = await secret_write({service, name: gone[0].name, value: ''});
        if (said.error !== undefined) {
            return `taking the secret ${gone[0].name} away: ${said.error}`;
        }
        gone.shift();
    }
    for (const row of rows) {
        if ((row.name === '') || ((row.copy_from === '') && (row.value === ''))) {
            continue;
        }
        const body = (row.copy_from === '') ? {service, name: row.name, value: row.value} : {service, name: row.name, copy_from: row.copy_from};
        const said = await secret_write(body);
        if (said.error !== undefined) {
            return `the secret ${row.name}: ${said.error}`;
        }
        const kept = said.services.find(v => (v.service === service) && (v.name === row.name));
        Object.assign(row, {value: '', copy_from: '', kept: true, length: (kept === undefined) ? 0 : kept.length});
    }
    return null;
}

export default secret_rows_write;
