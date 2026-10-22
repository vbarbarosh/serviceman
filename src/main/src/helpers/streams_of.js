// The streams commands answered with, by id: made the first time they are asked about
function streams_of(app)
{
    if (app.streams === undefined) {
        app.streams = new Map();
    }
    return app.streams;
}

module.exports = streams_of;
