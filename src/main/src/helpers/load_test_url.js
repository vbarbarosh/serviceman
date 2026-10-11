// The address a load test asks: its own, or the service's first, as serviceman serves it
function load_test_url(app, test)
{
    if (test.url !== null) {
        return test.url;
    }
    const service = app.service_by_name[test.service];
    if ((service === undefined) || (service.routes.length === 0)) {
        return null;
    }
    const route = service.routes[0];
    const port = app.config.listen.port;
    return `http://${route.host}${(port === 80) ? '' : `:${port}`}${route.path}/`;
}

module.exports = load_test_url;
