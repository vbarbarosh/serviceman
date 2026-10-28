const fs = require('fs');
const log_event = require('./log_event');
const path = require('path');

// Where each machine stands on the Canvas and how it is drawn, as the page last put them: kept
// in the state folder, read the first time it is asked for. No file, or one that does not
// read, is a canvas laid out afresh, never a reason to refuse to start.
//
//     -> {machines: {<name>: {x, y, kind}}}, the same object every time
function canvas_of(app)
{
    if (app.canvas !== undefined) {
        return app.canvas;
    }
    app.canvas = {machines: {}};
    try {
        const json = JSON.parse(fs.readFileSync(canvas_of.path(app), 'utf8'));
        if ((json !== null) && (typeof json.machines === 'object') && (json.machines !== null)) {
            app.canvas.machines = json.machines;
        }
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            log_event(app, 'canvas_read_error', {file: canvas_of.path(app), reason: error.message, then: 'laid out afresh'});
        }
    }
    return app.canvas;
}

// How a machine may be drawn; one never set is a server
canvas_of.KINDS = ['server', 'laptop', 'home'];

canvas_of.path = function (app) {
    return path.resolve(app.state_dir, 'canvas.json');
};

module.exports = canvas_of;
