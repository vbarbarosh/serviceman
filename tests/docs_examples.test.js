const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const DOCS = path.join(__dirname, '..', 'docs');
// What a whole config may hold, and what a service may: a block that is a part of either is
// read by its keys
const CONFIG_KEYS = ['listen', 'control', 'defaults', 'remotes', 'services', 'forwards', 'join', 'logline', 'load_tests', 'apps'];
const SERVICE_KEYS = ['policy', 'volumes', 'env', 'run_args', 'network', 'args', 'publish', 'image', 'command', 'argv', 'cwd', 'upstream', 'redirect', 'folder'];
const REMOTE_KEYS = ['inbound', 'tags'];
// The service a part of a service is tried in, and the token a shortened one (`0c0f…a91b`)
// stands for: a reader puts their own there
const SERVICE = {name: 'whoami', type: 'docker', remotes: ['vps1'], image: 'traefik/whoami', publish: {host: 'whoami.example.com', port: 80}};
const TOKEN = '0123456789abcdef0123456789ab';

// docs/usecases.md says of its examples "each one is a config you can copy", and the first
// config of docs/config.md was one serviceman would not start on. Every ```json block of the
// docs is a config, a part of one, a service or a line of services: each goes through the
// validator the real file goes through, with only what a part leaves out filled in (the
// machines and services it names, a whole token for a shortened one).
test('every json block of the docs is a config the validator takes', function () {
    const refused = [];
    let read = 0;
    for (const name of fs.readdirSync(DOCS).filter(v => v.endsWith('.md'))) {
        for (const block of blocks_of(path.join(DOCS, name))) {
            const where = `docs/${name}:${block.line}`;
            const values = values_of(block.text);
            if (values === null) {
                refused.push(`${where}: a json block that does not read as JSON: write it whole`);
                continue;
            }
            for (const value of values) {
                const config = config_of(value);
                if (config === null) {
                    refused.push(`${where}: a json block that is no config, part of one or service`);
                    continue;
                }
                read++;
                try {
                    config_from_json(config, DOCS);
                }
                catch (error) {
                    refused.push(`${where}: ${error.message}`);
                }
            }
        }
    }
    assert.deepStrictEqual(refused, []);
    assert.ok(read >= 39, `${read} examples read: the docs had 39`);
});

// Each ```json block of a file: {line, text}, line the first of its text
function blocks_of(file)
{
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const out = [];
    let at = null;
    for (let i = 0; i < lines.length; i++) {
        if (at === null) {
            at = /^\s*```json\s*$/.test(lines[i]) ? i : null;
        }
        else if (/^\s*```\s*$/.test(lines[i])) {
            out.push({line: at + 2, text: lines.slice(at + 1, i).join('\n')});
            at = null;
        }
    }
    return out;
}

// What a block says: one value, written whole or as the keys of an object (`"remotes": […]`),
// or an object a line; null when it reads as none of these
function values_of(text)
{
    for (const tried of [text, `{${text}}`]) {
        try {
            return [JSON.parse(tried)];
        }
        catch {
            // Read the next way
        }
    }
    try {
        return text.split('\n').filter(v => v.trim() !== '').map(v => JSON.parse(v));
    }
    catch {
        return null;
    }
}

// The whole config a value is tried as, null for a value that is no part of one. What a part
// names and leaves out is stood in for: the machines its services and forwards run on, the
// services its doors and load tests name.
function config_of(value)
{
    if ((value === null) || (typeof value !== 'object') || Array.isArray(value)) {
        return null;
    }
    const keys = Object.keys(value);
    let part = null;
    if ((typeof value.name === 'string') && (value.token !== undefined)) {
        part = {remotes: [value]};
    }
    else if (typeof value.name === 'string') {
        part = {services: [value]};
    }
    else if (keys.every(v => REMOTE_KEYS.includes(v))) {
        part = {remotes: [Object.assign({name: 'laptop', token: '0c0f…a91b'}, value)]};
    }
    else if (keys.every(v => CONFIG_KEYS.includes(v))) {
        part = value;
    }
    else if (keys.every(v => SERVICE_KEYS.includes(v))) {
        part = {services: [Object.assign({}, SERVICE, value)]};
    }
    if (part === null) {
        return null;
    }
    const counted = {tokens: 0};
    const config = tokens_whole(part, counted);
    config.remotes = (config.remotes || []).slice();
    config.services = (config.services || []).slice();
    const services = new Set(config.services.map(v => v.name));
    const rules = config.remotes.flatMap(v => Object.values(v.inbound || {}));
    const served = [].concat(rules.map(v => (typeof v === 'string') ? v : v.service), rules.map(v => v.auth), (config.load_tests || []).map(v => v.service));
    for (const name of served) {
        // "*" is no service: it is the one whose own address the name is
        if ((typeof name === 'string') && (name !== '*') && (services.has(name) === false)) {
            services.add(name);
            config.services.push({name, type: 'external', publish: {host: `${name}.internal.example.com`}, upstream: '127.0.0.1:8000'});
        }
    }
    const remotes = new Set(config.remotes.map(v => v.name));
    const ends = (config.forwards || []).flatMap(v => [v.from, v.to]).filter(v => (v !== undefined) && (v !== null));
    const machines = [].concat(config.services.flatMap(v => [].concat(v.remotes || [], v.remote)), ends.map(v => v.remote), (config.load_tests || []).map(v => v.remote));
    for (const name of machines) {
        if ((typeof name === 'string') && (name.startsWith('#') === false) && (remotes.has(name) === false)) {
            remotes.add(name);
            config.remotes.push({name, token: tokens_whole('…', counted)});
        }
    }
    return config;
}

// A copy of a value with every shortened token made whole, each its own: a token names its machine
function tokens_whole(value, counted)
{
    if (typeof value === 'string') {
        return value.includes('…') ? `${TOKEN}${String(++counted.tokens).padStart(4, '0')}` : value;
    }
    if (Array.isArray(value)) {
        return value.map(v => tokens_whole(v, counted));
    }
    if ((value !== null) && (typeof value === 'object')) {
        return Object.fromEntries(Object.entries(value).map(v => [v[0], tokens_whole(v[1], counted)]));
    }
    return value;
}
