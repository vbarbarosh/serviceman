// The tag a docker command's lines carry on their way back when somebody waits on them as they
// come, followed by the run's own number. Like `#apt` and `#k6:`, it is not the name of a
// service: the lines belong to the run that asked (docker_shell_said).
const docker_lane = '#docker:';

module.exports = docker_lane;
