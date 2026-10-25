const http = require('http');

// The shell inside the container learns the size of the pane it draws into. It never fails:
// a size that cannot be asked, or an engine that does not answer, leaves the shell its old
// size, and whoever asked goes on.
function docker_exec_resize(connect, exec_id, size)
{
    return new Promise(function (resolve) {
        let request;
        try {
            request = http.request({
                createConnection: connect,
                method: 'POST',
                path: `/exec/${encodeURIComponent(exec_id)}/resize?h=${encodeURIComponent(size.rows)}&w=${encodeURIComponent(size.cols)}`,
            }, function (answer) {
                answer.resume();
                answer.on('end', resolve);
            });
        }
        catch {
            resolve();
            return;
        }
        request.on('error', function () {
            resolve();
        });
        request.end();
    });
}

module.exports = docker_exec_resize;
