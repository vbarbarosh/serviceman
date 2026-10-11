const line_fields = require('./line_fields');

// Where a label lands in otel_logs: the names Logline's own docker receiver uses, so the log-ui
// reads these rows as it reads its own. A label not named here keeps its own name.
const RESOURCE_NAMES = {
    host: 'host.name',
    project: 'service.namespace',
    container: 'container.name',
    container_id: 'container.id',
    image: 'container.image.name',
};
const LOG_NAMES = {
    stream: 'log.iostream',
};

// The items of one batch -> rows for otel_logs. `remote` is the name of the token that let them
// in; it is the one label a machine cannot choose, so any `remote` it sent is dropped.
function rows_from_lines(items, remote)
{
    const out = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const resource = {remote};
        const log = Object.assign({'log.index': String(i)}, line_fields(item.line));
        let service = '';
        for (const name of Object.keys(item.labels)) {
            const value = item.labels[name];
            if (name === 'remote') {
                continue;
            }
            if (name === 'service') {
                service = value;
            }
            else if (LOG_NAMES[name] !== undefined) {
                log[LOG_NAMES[name]] = value;
            }
            else {
                resource[RESOURCE_NAMES[name] || name] = value;
            }
        }
        out.push({
            Timestamp: item.time,
            ServiceName: service,
            Body: item.line,
            ResourceAttributes: resource,
            LogAttributes: log,
        });
    }
    return out;
}

module.exports = rows_from_lines;
