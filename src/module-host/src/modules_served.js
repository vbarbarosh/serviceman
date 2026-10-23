const agent_port_list = require('../../agent/src/agent_port_list');
const agent_ufw = require('../../agent/src/agent_ufw');
const firewall_manifest = require('../../../modules/firewall/server/firewall_manifest');
const firewall_serve = require('../../../modules/firewall/server/firewall_serve');
const path = require('path');

// The modules this app loads, each given what it asks of its host by this computer itself: the
// same calls the ServiceMan agent makes on its machine, here without a link in between.
//
//     ui        the folder of its page half, served at /_/<key>/
//     manifest  what it holds and does, which its lists are drawn from
//     serve     its API at /api/<key>, with the address after that as tail
const modules_served = [
    {
        key: 'firewall',
        title: 'Firewall',
        ui: path.resolve(__dirname, '../../../modules/firewall/ui'),
        manifest: firewall_manifest,
        serve: function (req, res, tail) {
            return firewall_serve(req, res, {
                run: v => agent_ufw({ufw: process.env.UFW}, {argv: v}),
                ports: agent_port_list,
                tail,
                log: function (event, fields) {
                    console.log(`[${event}] ${JSON.stringify(fields)}`);
                },
            });
        },
    },
];

module.exports = modules_served;
