// How a service stands, in the word its kind says it with: what it is doing now; a folder of
// files is served, an address already running answers, one that sleeps until visited is asleep
function service_state_word(service)
{
    if (service.doing !== null) {
        return service.doing;
    }
    if (service.phase === 'running') {
        return {files: 'served', external: 'answers'}[service.type] || 'running';
    }
    if ((service.phase === 'stopped') && (service.policy.start === 'on_demand')) {
        return 'asleep';
    }
    return service.phase;
}

export default service_state_word;
