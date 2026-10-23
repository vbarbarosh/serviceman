const fs = require('fs');
const http = require('http');

// An app folder from the outside: it answers on PORT, with what bin/configure left
http.createServer(function (req, res) {
    res.end(`${fs.readFileSync('configured.txt', 'utf8').trim()} on ${process.env.PORT}`);
}).listen(Number(process.env.PORT), '127.0.0.1');
