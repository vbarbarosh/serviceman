// A pane's size, asked by whoever sits at it, is forwarded to a pty and a docker exec as it
// is: only whole numbers a terminal can have get through, so a frame carries no text into a
// request path and no number a window size cannot hold
const SIZE_MAX = 4096;

function term_size_valid(cols, rows)
{
    return side_valid(cols) && side_valid(rows);
}

function side_valid(value)
{
    return Number.isInteger(value) && (value >= 1) && (value <= SIZE_MAX);
}

module.exports = term_size_valid;
