const app_apply_config = require('./app_apply_config');
const config_file_save = require('./config_file_save');
const config_from_json = require('./config_from_json');
const config_locked = require('./config_locked');
const control_token_refusal = require('./control_token_refusal');
const control_tokens_read = require('./control_tokens_read');
const forward_token_refusal = require('./forward_token_refusal');
const fs = require('fs');
const log_event = require('./log_event');

// After a token is revoked, rotated or changed, what it may no longer do stops at once: the
// connections it holds open and may no longer have are cut (control_token_live), and the
// forwards it asked for and may no longer hold are set aside, their `by` kept, so the page says
// whose they were. Its kept terminals go on running, as a machine's agent keeps them: a revoked
// token can no longer list, join or end them. Answers the labels of the forwards set aside.
async function control_token_sweep(app, id)
{
    const token = control_tokens_read(app).find(v => (v.id === id));
    for (const item of Array.from(app.control_token_live)) {
        if (item.token !== id) {
            continue;
        }
        const reason = live_refusal(item, token);
        if (reason !== null) {
            app.control_token_live.delete(item);
            log_event(app, 'control_token_cut', {token: item.label, right: item.right.right, remote: item.right.remote, reason});
            item.socket.destroy();
        }
    }
    if (app.config.path === undefined) {
        return [];
    }
    try {
        return await config_locked(app, () => forwards_set_aside(app, id, token));
    }
    catch (error) {
        log_event(app, 'forward_set_aside_error', {token: id, reason: error.message});
        return [];
    }
}

// Why a connection the token holds open may not stay, or null when it may
function live_refusal(item, token)
{
    if (token === undefined) {
        return 'revoked';
    }
    if (token.sha256 !== item.sha256) {
        return 'rotated';
    }
    return control_token_refusal(item.right, token);
}

async function forwards_set_aside(app, id, token)
{
    const json = JSON.parse(await fs.promises.readFile(app.config.path, 'utf8'));
    const out = [];
    for (const item of (Array.isArray(json.forwards) ? json.forwards : [])) {
        if ((item.by === undefined) || (item.by === null) || (item.by.token !== id) || (item.off === true)) {
            continue;
        }
        const reason = forward_refusal(item, token);
        if (reason !== null) {
            item.off = true;
            out.push(item.label);
            log_event(app, 'forward_set_aside', {forward: item.label, token: item.by.label, reason});
        }
    }
    if (out.length > 0) {
        const config = config_from_json(json, app.config.base_dir);
        await config_file_save(app.config.path, `${JSON.stringify(json, null, 4)}\n`);
        await app_apply_config(app, config);
    }
    return out;
}

// Why the token may no longer hold a forward it asked for, or null when it may
function forward_refusal(item, token)
{
    if (token === undefined) {
        return 'its token was revoked';
    }
    if (token.rights.includes('forwards') === false) {
        return 'its token may no longer write the forwards';
    }
    const refused = forward_token_refusal(item, token);
    return (refused === null) ? null : `its token ${refused}`;
}

module.exports = control_token_sweep;
