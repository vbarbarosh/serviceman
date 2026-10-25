const fs = require('fs');

// A config file written for the first time is the operator's alone: it holds every machine's
// token and the join token
const FILE_MODE_NEW = 0o600;

// The config file, written whole beside itself and moved into place, with the mode it had: a
// file the operator keeps to themselves stays theirs, since it holds every machine's token.
// The one way serviceman writes the file, whoever asked: the page, a machine adding itself.
async function config_file_save(file, text)
{
    const mode = await mode_of(file);
    const temp = `${file}.serviceman-save`;
    await fs.promises.writeFile(temp, text, {mode});
    await fs.promises.chmod(temp, mode);
    await fs.promises.rename(temp, file);
}

async function mode_of(file)
{
    try {
        return (await fs.promises.stat(file)).mode & 0o777;
    }
    catch {
        return FILE_MODE_NEW;
    }
}

module.exports = config_file_save;
