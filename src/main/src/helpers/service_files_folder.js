const path = require('path');

// Where the files of a folder-of-files service are: the folder its config names, or
// apps/<name> in serviceman's state folder, where an app sent to serviceman is kept
function service_files_folder(app, service)
{
    return (service.folder === null) ? path.resolve(app.state_dir, 'apps', service.name) : service.folder;
}

module.exports = service_files_folder;
