const fs = require('fs');

// A bind mount whose folder is missing would be made by docker as root; the agent makes it first
async function agent_dir_create(dir)
{
    if (fs.existsSync(dir)) {
        return {created: false};
    }
    await fs.promises.mkdir(dir, {recursive: true});
    return {created: true};
}

module.exports = agent_dir_create;
