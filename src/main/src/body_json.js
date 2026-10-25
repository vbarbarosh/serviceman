const body_read = require('./body_read');

// A request body as the JSON it holds. What is wrong with it is said with a status of its own,
// `error.status`, for the caller to answer with: 400 for a body that is not JSON, 413 for one
// above the limit (body_bytes_read), where before the parser's words went out as a 500.
async function body_json(req, limit_bytes)
{
    const text = await body_read(req, limit_bytes);
    try {
        return JSON.parse(text);
    }
    catch (error) {
        const refusal = new Error(`the body is not JSON: ${error.message}`);
        refusal.status = 400;
        throw refusal;
    }
}

module.exports = body_json;
