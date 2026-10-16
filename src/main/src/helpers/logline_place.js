const docker_exec_connect = require('./docker_exec_connect');
const engine_json = require('./engine_json');
const fs = require('fs');
const logline_files = require('./logline_files');
const path = require('path');

const LABEL_PROJECT = 'com.docker.compose.project';
const LABEL_DIR = 'com.docker.compose.project.working_dir';
const LABEL_FILES = 'com.docker.compose.project.config_files';

// Where Logline runs: the machine of the service named logline, and the folder its compose
// project was started from, as its containers' labels say. Nothing to write in the config: the
// service already names the machine, and the project its folder. What is missing is said, in
// words the page shows.
//
//     out   {remote, project, dir, files}, files the compose files in full
async function logline_place(app)
{
    const service = app.service_by_name.logline;
    if (service === undefined) {
        throw new Error('no service is named logline: add Logline\'s viewer as an external service named logline, on the machine that runs it');
    }
    const name = ((Array.isArray(service.remotes) && (service.remotes.length > 0)) ? service.remotes[0] : null);
    if (name === null) {
        throw new Error('the service logline names no machine: Logline runs on one, and the service says which');
    }
    if (name.startsWith('#')) {
        throw new Error(`the service logline names a tag, ${name}: Logline runs on one machine, and the service names it`);
    }
    const remote = app.remote_by_name[name];
    if ((remote === undefined) || (remote.state.phase !== 'online')) {
        throw new Error(`${name}, where Logline runs, is not connected`);
    }
    const project = project_name();
    let connect;
    try {
        connect = docker_exec_connect(app, remote);
    }
    catch {
        throw new Error(`docker on ${name} has no socket its agent can reach`);
    }
    for (const item of await engine_json(connect, 'GET', '/containers/json?all=1')) {
        const labels = (((item.Labels === null) || (item.Labels === undefined)) ? {} : item.Labels);
        if ((labels[LABEL_PROJECT] === project) && (labels[LABEL_DIR] !== undefined)) {
            const files = ((labels[LABEL_FILES] === undefined) ? [] : labels[LABEL_FILES].split(',').filter(v => v !== ''));
            return {remote, project, dir: labels[LABEL_DIR], files: files.map(v => path.posix.resolve(labels[LABEL_DIR], v))};
        }
    }
    throw new Error(`no container on ${name} is of compose project ${project}: start Logline there once, by hand, with docker compose up -d in its folder`);
}

// The project's name, as Logline's compose file gives it
function project_name()
{
    const text = fs.readFileSync(path.join(logline_files.dir, 'docker-compose.yml'), 'utf8');
    const found = /^name:\s*(\S+)/m.exec(text);
    if (found === null) {
        throw new Error('Logline\'s docker-compose.yml names no project');
    }
    return found[1];
}

module.exports = logline_place;
