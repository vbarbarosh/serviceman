const canvas_of = require('./canvas_of');
const fs = require('fs');
const path = require('path');

// The Canvas written whole, beside the rest of serviceman's state; a new file first, then put in
// place, so a write cut short leaves the last one
function canvas_write(app)
{
    const file = canvas_of.path(app);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.new`;
    fs.writeFileSync(temp, `${JSON.stringify(canvas_of(app), null, 4)}\n`);
    fs.renameSync(temp, file);
}

module.exports = canvas_write;
