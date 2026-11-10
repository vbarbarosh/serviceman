// One line said by a disk, a machine or a service, as the object it is; null for a line that
// is no JSON object. What the far end says is an answer to read, never trusted to be well
// made: JSON.parse thrown inside a stream's listener, where nothing catches, ended the process.
function object_from_line(text)
{
    try {
        const said = JSON.parse(text);
        return ((said !== null) && (typeof said === 'object')) ? said : null;
    }
    catch {
        return null;
    }
}

module.exports = object_from_line;
