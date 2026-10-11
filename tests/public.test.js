const assert = require('assert');
const compiler = require('@vue/compiler-dom');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');

// Every template of every component on the page, compiled the way the browser compiles them.
//
// The page builds its components from template strings, and one that does not compile takes
// the whole page with it: vue throws while mounting and nothing is drawn — not the rail, not
// the header, nothing. A backslash-n written into a template literal is enough to do it, and
// it looks right in the file. So the templates are compiled here, where it costs a second.
test('every template on the control page compiles', function () {
    const files = fs.readdirSync(PUBLIC).filter(v => v.endsWith('.js'));
    let count = 0;
    for (const name of files) {
        for (const template of templates_of(fs.readFileSync(path.join(PUBLIC, name), 'utf8'))) {
            count++;
            template_compile(template, `${name} #${count}`);
        }
    }
    assert.strictEqual(count > 10, true, `the page is made of more templates than this (found ${count})`);
});

test('a template that cannot compile is caught here', function () {
    // What a `\n` written into a template literal becomes: a real newline inside the mustache,
    // which is the bug this file exists for
    assert.throws(() => template_compile("<p>{{ lines.join('\n') }}</p>", 'the bad one'));
    assert.throws(() => template_compile('<p v-if="(">nope</p>', 'the other bad one'));
});

// The text a component hands to vue: what is between the backticks of `template:`, after js
// has had its way with the escapes
function templates_of(text)
{
    const out = [];
    const mark = 'template: `';
    for (let at = text.indexOf(mark); at !== -1; at = text.indexOf(mark, at + 1)) {
        const end = text.indexOf('`', at + mark.length);
        if (end === -1) {
            continue;
        }
        const raw = text.slice(at + mark.length, end);
         
        out.push(new Function(`return \`${raw}\`;`)());
    }
    return out;
}

// Compiled, then made into a function — which is where an expression that is not javascript
// says so, exactly as it would in the browser
function template_compile(template, label)
{
    const compiled = compiler.compile(template, {onError: function (error) {
        throw new Error(`${label}: ${error.message}`);
    }});
     
    new Function(compiled.code);
}
