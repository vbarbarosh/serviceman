const assert = require('assert');
const test = require('node:test');

test('names that did not all go are said by count and by the disk\'s own words; one name alone is the disk\'s words alone', async function () {
    const rename_said = (await import('../ui/rename_said.js')).default;
    function taken(name) {
        return `remote laptop: ${name} is there already`;
    }

    // One name: what the disk said, as it said it
    assert.strictEqual(rename_said('renamed', 1, 0, [taken('report.txt')], ''), 'remote laptop: report.txt is there already');
    assert.strictEqual(rename_said('moved', 1, 0, [], 'remote laptop did not answer within 15s'), 'remote laptop did not answer within 15s');

    // Several: which went, which stay, and why; the names that are taken are counted, not listed
    assert.strictEqual(rename_said('moved', 3, 2, [taken('b.txt')], ''), '2 of 3 moved, 1 stays here — remote laptop: b.txt is there already');
    assert.strictEqual(rename_said('moved', 4, 2, [taken('b.txt'), taken('c.txt')], ''), '2 of 4 moved, 2 stay here — remote laptop: b.txt is there already, and so is 1 more');
    assert.strictEqual(rename_said('moved', 1000000, 1, Array.from({length: 999999}, () => taken('b.txt')), ''), '1 of 1000000 moved, 999999 stay here — remote laptop: b.txt is there already, and so are 999998 more');
    assert.strictEqual(rename_said('moved', 3, 0, [taken('a.txt'), taken('b.txt'), taken('c.txt')], ''), 'none of 3 moved — remote laptop: a.txt is there already, and so are 2 more');

    // A refusal that stopped the rest comes last, after what was taken before it
    assert.strictEqual(rename_said('moved', 3, 1, [], 'remote laptop: the link dropped before the answer came'), '1 of 3 moved, 2 stay here — remote laptop: the link dropped before the answer came');
    assert.strictEqual(rename_said('moved', 5, 1, [taken('b.txt')], 'remote laptop: EXDEV: cross-device link not permitted'), '1 of 5 moved, 4 stay here — remote laptop: b.txt is there already; remote laptop: EXDEV: cross-device link not permitted');
});
