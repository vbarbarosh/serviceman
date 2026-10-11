const assert = require('assert');
const line_fields = require('./line_fields');
const rows_from_lines = require('./rows_from_lines');
const test = require('node:test');

test('a line in the rules\' form gives its fields; any other line gives none', function () {
    assert.deepStrictEqual(line_fields('[c7t0xb1m][mp4gif_worker_end_error] 0.884s ffmpeg exit=1'), {group_uid: 'c7t0xb1m', sender: 'mp4gif_worker_end_error', details: '0.884s ffmpeg exit=1'});
    assert.deepStrictEqual(line_fields('[c7t0xb1m][mp4gif_worker_begin]'), {group_uid: 'c7t0xb1m', sender: 'mp4gif_worker_begin'});
    assert.deepStrictEqual(line_fields('[cd8e5vqp][group_spawn] parent=c7f3a91k'), {group_uid: 'cd8e5vqp', sender: 'group_spawn', details: 'parent=c7f3a91k', parent_group_uid: 'c7f3a91k'});
    assert.deepStrictEqual(line_fields('[c1a0root][group_spawn]'), {group_uid: 'c1a0root', sender: 'group_spawn'});
    assert.deepStrictEqual(line_fields('[info][Main Thread] started'), {}, 'a sender is snake_case');
    assert.deepStrictEqual(line_fields('GET /x 200 0.004s'), {});
    assert.deepStrictEqual(line_fields(' [c7t0xb1m][x]'), {}, 'the form starts the line');
});

test('labels land where the log-ui reads them, and remote is the token\'s', function () {
    const rows = rows_from_lines([
        {
            time: '2026-09-25T18:17:09.979000000Z',
            labels: {
                'host': 'server.example.com',
                'service': 'ffmpeg',
                'project': 'media',
                'container': 'media-ffmpeg-1',
                'container_id': '3f2a9c1d0b7e',
                'image': 'jrottenberg/ffmpeg:7',
                'stream': 'stderr',
                'remote': 'someone-else',
                'region': 'eu',
            },
            line: '[c7t0xb1m][mp4gif_worker_begin]',
        },
        {time: '2026-09-25T18:17:09.979000000Z', labels: {}, line: 'plain output'},
    ], 'server');
    assert.deepStrictEqual(rows[0], {
        Timestamp: '2026-09-25T18:17:09.979000000Z',
        ServiceName: 'ffmpeg',
        Body: '[c7t0xb1m][mp4gif_worker_begin]',
        ResourceAttributes: {
            'remote': 'server',
            'host.name': 'server.example.com',
            'service.namespace': 'media',
            'container.name': 'media-ffmpeg-1',
            'container.id': '3f2a9c1d0b7e',
            'container.image.name': 'jrottenberg/ffmpeg:7',
            'region': 'eu',
        },
        LogAttributes: {'log.index': '0', 'group_uid': 'c7t0xb1m', 'sender': 'mp4gif_worker_begin', 'log.iostream': 'stderr'},
    });
    assert.deepStrictEqual(rows[1], {Timestamp: '2026-09-25T18:17:09.979000000Z', ServiceName: '', Body: 'plain output', ResourceAttributes: {remote: 'server'}, LogAttributes: {'log.index': '1'}});
});
