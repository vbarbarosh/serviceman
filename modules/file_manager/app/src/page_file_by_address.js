const fs = require('fs');
const path = require('path');

const MAIN = path.resolve(__dirname, '../../../../src/main/public');
const PUBLIC = path.resolve(__dirname, '../public');
const UI = path.resolve(__dirname, '../../ui');

// Every file of the page, by the address it is asked for, from where it sits in the repository;
// the app folder bin/file-manager-zip makes keeps each one at the same place. The addresses are
// the page's own: the module's half at _/file_manager/, and the control page's table two folders
// above it, where the component imports it from (../../data_table.js). Nothing else is served.
const page_file_by_address = Object.assign({
    '/': path.join(PUBLIC, 'index.html'),
    '/_/app/files_app.css': path.join(PUBLIC, 'files_app.css'),
    '/_/app/files_app.js': path.join(PUBLIC, 'files_app.js'),
    '/_/serviceman.css': path.join(MAIN, 'serviceman.css'),
    '/_/vendor/codemirror.mjs': path.join(MAIN, 'vendor/codemirror.mjs'),
    '/_/vendor/vue.esm-browser.prod.js': path.join(MAIN, 'vendor/vue.esm-browser.prod.js'),
    '/data_table.js': path.join(MAIN, 'data_table.js'),
    '/fold_table.js': path.join(MAIN, 'fold_table.js'),
}, ui_files_read());

// The module's page half: each file of its folder, under _/file_manager/
function ui_files_read()
{
    const out = {};
    for (const name of fs.readdirSync(UI)) {
        out[`/_/file_manager/${name}`] = path.join(UI, name);
    }
    return out;
}

module.exports = page_file_by_address;
