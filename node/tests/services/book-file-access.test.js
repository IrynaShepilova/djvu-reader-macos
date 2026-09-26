const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { getBookFileAccess } = require('../../src/services/book-file-access');

const networkBookPath = '/Volumes/Library-NAS/Books/book.djvu';

test('identifies a disconnected network volume even when its mount-point directory remains accessible', () => {
    const result = getBookFileAccess(networkBookPath, {
        platform: 'darwin',
        getMountedVolumePaths: () => ['/Volumes/Other-Volume'],
        accessSync: () => {},
        statSync: () => {
            throw new Error('should not check a disconnected volume');
        },
    });

    assert.deepEqual(result, {
        available: false,
        code: 'NETWORK_VOLUME_UNAVAILABLE',
        volumePath: '/Volumes/Library-NAS',
    });
});

test('identifies a missing book on an accessible mounted network volume as missing', () => {
    const missingFile = Object.assign(new Error('not found'), { code: 'ENOENT' });
    const result = getBookFileAccess(networkBookPath, {
        platform: 'darwin',
        getMountedVolumePaths: () => ['/Volumes/Library-NAS'],
        accessSync: () => {},
        statSync: () => {
            throw missingFile;
        },
    });

    assert.deepEqual(result, {
        available: false,
        code: 'FILE_NOT_FOUND',
    });
});

test('allows a book on an accessible mounted network volume', () => {
    const result = getBookFileAccess(networkBookPath, {
        platform: 'darwin',
        getMountedVolumePaths: () => ['/Volumes/Library-NAS'],
        accessSync: () => {},
        statSync: () => ({ isFile: () => true }),
    });

    assert.deepEqual(result, { available: true });
});
