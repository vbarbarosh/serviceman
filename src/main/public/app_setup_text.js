// What runs in an app folder before bin/run, in words, bin/configure first: 'bin/configure and
// bin/build run', 'bin/build runs', or '' for neither
//
//     files  {configure, build}, as app_entries_read gives them
function app_setup_text(files)
{
    const steps = [];
    if (files.configure) {
        steps.push('bin/configure');
    }
    if (files.build) {
        steps.push('bin/build');
    }
    if (steps.length === 0) {
        return '';
    }
    return `${steps.join(' and ')} ${(steps.length === 1) ? 'runs' : 'run'}`;
}

export default app_setup_text;
