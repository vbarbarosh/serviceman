// app.services is the source of truth; the lookup tables are derived from it. They are looked
// up with names and hosts a request brings, so they have no prototype (app_from_config).
function app_routes_rebuild(app)
{
    app.service_by_name = Object.create(null);
    app.routes_exact = Object.create(null);
    app.routes_wildcard = [];
    for (const service of app.services) {
        app.service_by_name[service.name] = service;
        for (const route of service.routes) {
            if (route.host.startsWith('*.')) {
                app.routes_wildcard.push({suffix: route.host.slice(1), path: route.path, service});
                continue;
            }
            if (app.routes_exact[route.host] === undefined) {
                app.routes_exact[route.host] = [];
            }
            app.routes_exact[route.host].push({path: route.path, service});
        }
    }
    for (const host of Object.keys(app.routes_exact)) {
        app.routes_exact[host].sort((a, b) => b.path.length - a.path.length);
    }
}

module.exports = app_routes_rebuild;
