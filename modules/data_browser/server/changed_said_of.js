const json_from_ejson = require('./json_from_ejson');

// How much of a value the words show
const VALUE_MOST = 60;

// Why a row edited was not saved: another hand changed some of the columns it changes since it
// was read, each said with what it holds now, so nothing is saved over unseen.
//
//     changed_said_of(['status'], {id: 7, status: 'shipped'})
//     // 'it changed since it was read, by another hand: status is "shipped" now'
function changed_said_of(names, item)
{
    const nows = names.map(v => `${v} is ${value_text(item[v])} now`);
    return `it changed since it was read, by another hand: ${nows.join(', ')}`;
}

function value_text(value)
{
    const text = json_from_ejson((value === undefined) ? null : value);
    return (text.length > VALUE_MOST) ? `${text.slice(0, VALUE_MOST - 1)}…` : text;
}

module.exports = changed_said_of;
