const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scanner = require('../../src/services/scanner');

function writeFile(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'book');
}

test('automatic scans exclude PDFs in Downloads while retaining DjVu files and PDFs elsewhere', async () => {
    const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'djvu-reader-scanner-'));
    const originalHomeDir = os.homedir;

    os.homedir = () => temporaryHome;

    try {
        const downloadsPath = path.join(temporaryHome, 'Downloads');
        const libraryPath = path.join(temporaryHome, 'Library');

        writeFile(path.join(downloadsPath, 'download.pdf'));
        writeFile(path.join(downloadsPath, 'nested', 'nested.pdf'));
        writeFile(path.join(downloadsPath, 'nested', 'book.djvu'));
        writeFile(path.join(libraryPath, 'library.pdf'));

        const scanned = await scanner.scanAllAsync([downloadsPath, libraryPath]);

        assert.deepEqual(
            scanned.map(book => book.fullPath).sort(),
            [
                path.join(downloadsPath, 'nested', 'book.djvu'),
                path.join(libraryPath, 'library.pdf'),
            ].sort(),
        );
    } finally {
        os.homedir = originalHomeDir;
        fs.rmSync(temporaryHome, { recursive: true, force: true });
    }
});

test('manual-import file validation continues to accept PDFs in Downloads', () => {
    const downloadsPdf = path.join(os.homedir(), 'Downloads', 'manual.pdf');

    assert.equal(scanner.isSupportedBookFile(downloadsPdf), true);
    assert.equal(scanner.isPdfInDownloads(downloadsPdf), true);
});
