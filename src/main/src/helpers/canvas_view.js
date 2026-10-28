const canvas_of = require('./canvas_of');
const machine_light = require('./machine_light');
const streams_of = require('./streams_of');

// The Canvas as the page draws it: every machine of the config, where it stands (null where it
// was never put anywhere: the page lays it out), how it is drawn, and its light
//
//     remotes   the machines' views; health, services: as the status has them
//     -> {machines: [{name, title, kind, x, y, light, work, said}]}
function canvas_view(app, remotes, health, services)
{
    const kept = canvas_of(app).machines;
    const running = Array.from(streams_of(app).values()).filter(v => (v.kind === 'lines') && (v.ended_at === null)).map(v => v.base);
    const machines = remotes.map(function (view) {
        const remote = app.remote_by_name[view.name];
        const apt = (remote !== undefined) && (remote.state.apt !== undefined) && (remote.state.apt !== null) && (remote.state.apt.phase === 'running');
        const busy = {
            apt,
            docker: running.includes(`/api/v1/remotes/${encodeURIComponent(view.name)}/docker`),
            mend: app.security.mending.has(view.name),
        };
        const place = (kept[view.name] === undefined) ? {} : kept[view.name];
        const kind = canvas_of.KINDS.includes(place.kind) ? place.kind : 'server';
        const at = Number.isFinite(place.x) && Number.isFinite(place.y);
        return Object.assign({name: view.name, title: view.title || view.name, kind, x: at ? place.x : null, y: at ? place.y : null}, machine_light(view, health, services, busy));
    });
    return {machines};
}

module.exports = canvas_view;
