// What became of stdout and of stderr: whether an error there is listened for yet, and
// whether one came
const STREAMS = {stdout: {heard: false, gone: false}, stderr: {heard: false, gone: false}};

// One line to stdout or to stderr (`name` says which), for as long as it takes lines. Under
// docker it always does. Under a pipe (`| tee`, a supervisor that restarts its reader) the
// reader may go, and the line after that comes back a moment later as an error on the stream:
// with nobody listening, it ended the process. Listened for, it is the last line tried there;
// the log's file, the page and the link go on taking theirs.
function std_line(name, line)
{
    const stream = STREAMS[name];
    if (stream.heard === false) {
        stream.heard = true;
        process[name].on('error', function () {
            stream.gone = true;
        });
    }
    if (stream.gone) {
        return;
    }
    if (name === 'stdout') {
        console.log(line);
        return;
    }
    console.error(line);
}

module.exports = std_line;
