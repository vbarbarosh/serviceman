const assert = require('assert');
const render_page = require('../src/main/src/helpers/render_page');
const test = require('node:test');

// A page's title is text the config gave, a service's title say, and goes into the page as text
test('the title of a page serviceman renders is text, whatever it holds', function () {
    const page = render_page({title: '</title><script>alert(document.domain)</script> did not start', body: '<h1>x</h1>'});
    assert.match(page, /<title>&lt;\/title&gt;&lt;script&gt;alert\(document\.domain\)&lt;\/script&gt; did not start<\/title>/);
    assert.strictEqual(page.includes('<script>alert'), false);
    assert.match(render_page({title: 'plain', body: ''}), /<title>plain<\/title>/);
});
