const compose_mounts = require('./compose_mounts');
const docker_shell = require('./docker_shell');
const fs = require('fs');
const log_event = require('./log_event');
const logline_compare = require('./logline_compare');
const logline_files = require('./logline_files');
const logline_place = require('./logline_place');
const path = require('path');
const remote_disk = require('./remote_disk');

// Logline on its machine made the same as the one this serviceman carries: the files that
// differ put in its folder, its project started again with whatever changed built, and every
// container that mounts a file that changed started again too. A file is put whole under a
// new name and renamed over the old one, so a container that mounts it keeps the old one
// until it is started again. .env and what Logline keeps are its machine's, and stay.
//
//     say   called with each step as it goes: {step, steps, name, text} or {text}
//     out   {said}; throws with what stopped it
async function logline_update(app, say)
{
    const steps = 4;
    say({step: 1, steps, name: 'Find Logline', text: 'the machine of the service logline, and its compose project there'});
    const place = await logline_place(app);
    say({text: `${place.project} in ${place.dir} on ${place.remote.name}`});

    say({step: 2, steps, name: 'Compare its files', text: 'every file of Logline here, against the same file there, by sha256'});
    const files = await logline_compare(app, place);
    const changed = files.filter(v => v.state !== 'same');
    if (changed.length === 0) {
        say({text: `all ${files.length} files are the same: nothing to do`});
        return {said: `Logline on ${place.remote.name} is up to date`};
    }
    for (const item of changed) {
        say({text: `${item.state}: ${item.path}`});
    }

    say({step: 3, steps, name: `Put ${changed.length} ${(changed.length === 1) ? 'file' : 'files'}`, text: `into ${place.dir} on ${place.remote.name}`});
    const disk = remote_disk(app, place.remote);
    for (const item of changed) {
        const parts = item.path.split('/');
        await disk.write(path.posix.join(place.dir, ...parts.slice(0, -1)), parts[parts.length - 1], fs.createReadStream(item.abs));
        say({text: `put ${item.path}`});
    }
    log_event(app, 'logline_update_put', {remote: place.remote.name, files: changed.length});

    const compose = ['compose', '-p', place.project].concat(place.files.flatMap(v => ['-f', v]));
    const again = services_to_restart(changed);
    say({step: 4, steps, name: 'Start it again', text: `$ docker ${compose.concat(['up', '-d', '--build']).join(' ')}`});
    await run(app, place.remote, compose.concat(['up', '-d', '--build']), say);
    if (again.length > 0) {
        say({text: `$ docker ${compose.concat(['restart'], again).join(' ')}`});
        await run(app, place.remote, compose.concat(['restart'], again), say);
    }
    log_event(app, 'logline_update_ok', {remote: place.remote.name, files: changed.length, restarted: again.join(',')});
    return {said: `Logline on ${place.remote.name}: ${changed.length} ${(changed.length === 1) ? 'file' : 'files'} put, started again`};
}

// The services that mount a file that changed: the compose file says which mounts which
function services_to_restart(changed)
{
    const text = fs.readFileSync(path.join(logline_files.dir, 'docker-compose.yml'), 'utf8');
    const mounts = compose_mounts(text);
    return Object.keys(mounts).filter(v => mounts[v].some(vv => changed.some(vvv => ((vvv.path === vv) || vvv.path.startsWith(`${vv}/`)))));
}

async function run(app, remote, argv, say)
{
    const answer = await docker_shell(app, remote, argv);
    const printed = `${answer.stdout}${answer.stderr}`.replace(/\n$/, '');
    if (printed !== '') {
        say({text: printed});
    }
    if (answer.ok === false) {
        throw new Error(`docker ${argv.slice(0, 1).concat(argv.slice(-2)).join(' ')} failed${((answer.code === null) || (answer.code === undefined)) ? '' : ` with code ${answer.code}`}`);
    }
}

module.exports = logline_update;
