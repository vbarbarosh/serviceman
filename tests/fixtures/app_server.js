const http = require('http');

// What an installed app looks like from the outside: something that answers on its port
const port = Number(process.argv[2]);

http.createServer(function (req, res) {
    res.end(`the app answers ${req.url}`);
}).listen(port, '127.0.0.1');
