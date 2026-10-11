const http = require('http');

// The shell inside the container learns the size of the pane it draws into
function docker_exec_resize(connect, exec_id, size)
{
    return new Promise(function (resolve) {
        const req = http.request({
            createConnection: connect,
            method: 'POST',
            path: `/exec/${exec_id}/resize?h=${size.rows}&w=${size.cols}`,
        }, function (res) {
            res.resume();
            res.on('end', resolve);
        });
        req.on('error', function () {
            resolve();
        });
        req.end();
    });
}

module.exports = docker_exec_resize;
