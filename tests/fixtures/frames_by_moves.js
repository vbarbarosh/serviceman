// Draws by moves, knowing its width, as an inline program does: a frame of three lines, its long
// one 150 characters, drawn again over itself on each key; q ends it
for (let i = 0; i < 30; i++) {
    process.stdout.write(`line ${i}\r\n`);
}
process.stdout.write('\r\n\r\n\r\n\r\n');
process.stdin.setRawMode(true);
let n = 0;
process.stdin.on('data', function (key) {
    if (String(key) === 'q') {
        process.exit(0);
    }
    const up = 2 + Math.ceil(150/process.stdout.columns);
    process.stdout.write(`\x1b[${up}A\r\x1b[J> frame ${n}\r\n${'='.repeat(150)}\r\n  status ${n}\r\n`);
    n++;
});
