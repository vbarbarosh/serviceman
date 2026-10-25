const agent_exec_bits = require('./agent_exec_bits');
const agent_part_path = require('./agent_part_path');
const fs = require('fs');

// The last part is in: the parts become the file, under its own name. Only a whole file does —
// one byte short, and the name is left as it was. A file that is there is written over as
// itself: through a link to the file the link points at, and with the permissions it had; a
// new one takes the run bits of params.mode, the mode it had where it came from.
async function agent_file_part_finish(params)
{
    const where = agent_part_path(params);
    const size = Number(params.size);
    if ((size === 0) && (fs.existsSync(where.part) === false)) {
        fs.writeFileSync(where.part, '');
    }
    // The parts are a file this agent wrote, not a link somebody put under that name meanwhile
    const part = fs.lstatSync(where.part);
    if (part.isFile() === false) {
        throw new Error(`${where.part} is not the file that was written`);
    }
    const have = part.size;
    if (have !== size) {
        throw new Error(`the file has ${have} bytes so far, not ${size}`);
    }
    const replaced = fs.existsSync(where.full);
    const written = replaced ? fs.realpathSync(where.full) : where.full;
    if (replaced) {
        fs.chmodSync(where.part, fs.statSync(written).mode & 0o7777);
    }
    else {
        agent_exec_bits(where.part, params.mode);
    }
    try {
        fs.renameSync(where.part, written);
    }
    catch (error) {
        // A link to a file on another disk: one rename cannot carry it there
        if (error.code !== 'EXDEV') {
            throw error;
        }
        fs.copyFileSync(where.part, written);
        fs.rmSync(where.part);
    }
    return {path: where.full, bytes: size, replaced};
}

module.exports = agent_file_part_finish;
