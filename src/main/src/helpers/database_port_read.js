const database_engines = require('./database_engines');
const engine_call = require('./engine_call');
const engine_said = require('./engine_said');

// The port a database server listens on at its machine's 127.0.0.1, as docker says it now:
// docker picks it as the container starts, and may pick another at a later start (the machine
// restarted, or its docker). null while the container does not run.
async function database_port_read(connect, server)
{
    const engine = database_engines.find(v => v.value === server.engine);
    const inspected = await engine_call(connect, 'GET', `/containers/serviceman-db-${server.name}/json`);
    if (inspected.status !== 200) {
        throw new Error(engine_said(inspected));
    }
    const all = JSON.parse(inspected.body).NetworkSettings.Ports;
    const ports = ((all === null) || (all === undefined)) ? null : all[`${engine.port}/tcp`];
    return ((ports === null) || (ports === undefined) || (ports.length === 0)) ? null : Number(ports[0].HostPort);
}

module.exports = database_port_read;
