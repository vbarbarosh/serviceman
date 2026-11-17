// What the boards published on a machine add to its door, in the rules' own shape
// ({service, off, auth}, as remotes_from_json reads them): each board at its name under
// .localhost, a page serviceman writes and its door hands over ("*", with the board named);
// each app on one at its name there, the app's own label as Apps gives it (`_` a `-`), routed
// as any of the door's names is, straight to where it runs. The agent answers them on
// 127.0.0.1 alone, at each board's port.
//
//     {rules: {host: rule}, ports: [port]}: nothing and none for a machine no board is on
function board_rules(app, remote_name)
{
    const rules = {};
    const ports = [];
    for (const board of app.config.boards) {
        if (board.machines.includes(remote_name) === false) {
            continue;
        }
        if (ports.includes(board.port) === false) {
            ports.push(board.port);
        }
        rules[`${board.name}.localhost`] = {service: '*', off: false, auth: null, board: board.name};
        for (const name of board.apps) {
            rules[`${name.replace(/_/g, '-')}.localhost`] = {service: name, off: false, auth: null};
        }
    }
    ports.sort((a, b) => a - b);
    return {rules, ports};
}

// A machine's door rules whole: the ones written for it, and those its boards add
board_rules.with_inbound = function (app, remote) {
    return Object.assign({}, board_rules(app, remote.name).rules, remote.inbound || {});
};

module.exports = board_rules;
