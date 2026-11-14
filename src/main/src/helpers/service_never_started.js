// A service serviceman never starts or stops: something that already runs somewhere, which it
// only gives an address, and a folder of files, which it serves itself and where nothing runs
function service_never_started(service)
{
    return (service.type === 'external') || (service.type === 'files');
}

module.exports = service_never_started;
