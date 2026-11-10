const body_read = require('./body_read');

// A request body as the fields it holds: a JSON object. An empty body holds none, and reads as
// {}. What is wrong with a body is said with a status of its own, `error.status`, for the
// caller to answer with: 400 for one that is not JSON, and for JSON that is no object (null, a
// list, a word, a number), whose first field read would otherwise be a 500 with the exception
// in it; 413 for one above the limit (body_read).
async function body_fields(req, limit_bytes)
{
    const text = await body_read(req, limit_bytes);
    if (text === '') {
        return {};
    }
    let value;
    try {
        value = JSON.parse(text);
    }
    catch (error) {
        const refusal = new Error(`the body is not JSON: ${error.message}`);
        refusal.status = 400;
        throw refusal;
    }
    if ((value === null) || (typeof value !== 'object') || Array.isArray(value)) {
        const refusal = new Error('the body is not a JSON object: its fields are what is read');
        refusal.status = 400;
        throw refusal;
    }
    return value;
}

module.exports = body_fields;
