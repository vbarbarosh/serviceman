// The value the sketch's REST row of an app's Data tab puts in its variable, as serviceman would
// give it: /_data/ at the app's address, app {kind, host}; a page asks its own
function app_data_value(item, app)
{
    if (app.kind === 'page') {
        return '/_data/';
    }
    return `http://${app.host}/_data/`;
}

export default app_data_value;
