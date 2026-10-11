const link_send = require('./link_send');

// Everything both ends say to each other, apart from the bytes of a blast
function link_send_message(socket, message)
{
    return link_send(socket, 'm', Buffer.from(JSON.stringify(message)));
}

module.exports = link_send_message;
