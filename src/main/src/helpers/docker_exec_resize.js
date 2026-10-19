const http = require('http');

// The shell inside the container learns the size of the pane it draws into
function docker_exec_resize(connect, exec_id, size)
{
    return new Promise(function (resolve) {
        const request = http.request({
            createConnection: connect,
            method: 'POST',
            path: `/exec/${exec_id}/resize?h=${size.rows}&w=${size.cols}`,
        }, function (answer) {
            answer.resume();
            answer.on('end', resolve);
        });
        request.on('error', function () {
            resolve();
        });
        request.end();
    });
}

module.exports = docker_exec_resize;
