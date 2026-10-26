// Where a program runs: the machine running it, else the first one its config names, and its
// folder there, whole. A folder that is not absolute is under the agent's services folder, as
// the agent reads it. `why` says what cannot be told yet, and remote is null then.
function program_place(view, remotes)
{
    const running = view.instances.find(v => (v.phase === 'running') && (v.remote !== null));
    const name = (running !== undefined) ? running.remote : view.remotes.find(v => v.startsWith('#') === false);
    if (name === undefined) {
        return {remote: null, folder: null, why: `It runs on a machine of ${view.remotes.join(', ')}, picked when it starts: once it runs, its files and its shell are here.`};
    }
    const remote = remotes.find(v => v.name === name);
    if (remote === undefined) {
        return {remote: null, folder: null, why: `${name} is not one of serviceman's machines.`};
    }
    if ((view.folder !== null) && view.folder.startsWith('/')) {
        return {remote, folder: view.folder, why: null};
    }
    const services = (remote.machine === null) ? null : remote.machine.services;
    if (services === null) {
        return {remote: null, folder: null, why: `${name} has not connected since serviceman last started, so where its programs live is not known yet.`};
    }
    const root = services.replace(/\/+$/, '');
    const under = (view.folder === null) ? '' : view.folder.replace(/^(\.\/)+|\/+$/g, '');
    return {remote, folder: ((under === '') || (under === '.')) ? root : `${root}/${under}`, why: null};
}

export default program_place;
