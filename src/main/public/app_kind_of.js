// What runs an app, in the words of the New service form: page, socket, app folder, docker image,
// program, already running
function app_kind_of(app)
{
    if (app.type === 'files') {
        return 'page';
    }
    if ((app.socket !== null) && (app.socket !== undefined)) {
        return 'socket';
    }
    if ((app.app_folder !== null) && (app.app_folder !== undefined)) {
        return 'app folder';
    }
    return {docker: 'docker image', shell: 'program', external: 'already running'}[app.type] || app.type;
}

export default app_kind_of;
