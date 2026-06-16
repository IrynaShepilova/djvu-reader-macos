const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {getScanFolders} = require("./settings-store");

const MAX_SCAN_DEPTH = 3;


function hashPath(fullPath) {
    return crypto.createHash('sha1').update(fullPath).digest('hex');
}

function scanFolderRecursive(dir, depth = 0) {
    if (depth > MAX_SCAN_DEPTH) return [];
    if (!fs.existsSync(dir)) return [];

    const result = [];
    let entries;

    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return result;
    }

    for (const entry of entries) {

        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isFile() && /\.(djvu|djv)$/i.test(entry.name)) {
            result.push({
                id: hashPath(fullPath),
                fullPath,
                title: path.parse(entry.name).name,
                filename: entry.name,
            });
        }

        if (entry.isDirectory()) {
            result.push(...scanFolderRecursive(fullPath, depth + 1));
        }
    }

    return result;
}

function scanAll(scanDirs) {
    return scanDirs.flatMap(dir => scanFolderRecursive(dir, 0));
}

function checkFolderAvailability(folderPath) {
    try {
        if (!fs.existsSync(folderPath)) {
            return {
                status: 'missing',
                errorMessage: 'Folder is not available',
            };
        }

        const stat = fs.statSync(folderPath);

        if (!stat.isDirectory()) {
            return {
                status: 'error',
                errorMessage: 'Not a directory',
            };
        }

        try {
            fs.readdirSync(folderPath);
        } catch (err) {
            if (err.code === 'EACCES' || err.code === 'EPERM') {
                return {
                    status: 'denied',
                    errorMessage: 'Permission denied',
                };
            }

            return {
                status: 'error',
                errorMessage: err.message,
            };
        }

        return {
            status: 'available',
            errorMessage: null,
        };

    } catch (err) {
        return {
            status: 'error',
            errorMessage: err.message,
        };
    }
}

function yieldToEventLoop() {
    return new Promise(resolve => setImmediate(resolve));
}

async function scanFolderRecursiveAsync(dir, options = {}, depth = 0) {
    const {
        onProgress,
        stats = { scannedEntries: 0, foundBooks: 0 },
    } = options;

    if (depth > MAX_SCAN_DEPTH) return [];
    if (!fs.existsSync(dir)) return [];

    const result = [];
    let entries;

    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return result;
    }

    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        stats.scannedEntries++;

        if (entry.isFile() && /\.(djvu|djv)$/i.test(entry.name)) {
            stats.foundBooks++;

            result.push({
                id: hashPath(fullPath),
                fullPath,
                title: path.parse(entry.name).name,
                filename: entry.name,
            });
        }

        if (entry.isDirectory()) {
            result.push(
                ...(await scanFolderRecursiveAsync(fullPath, options, depth + 1))
            );
        }

        if (stats.scannedEntries % 50 === 0) {
            onProgress?.({
                ...stats,
                currentPath: fullPath,
            });

            await yieldToEventLoop();
        }
    }

    return result;
}

async function scanAllAsync(scanDirs, options = {}) {
    const result = [];
    const stats = { scannedEntries: 0, foundBooks: 0 };

    for (const dir of scanDirs) {
        result.push(
            ...(await scanFolderRecursiveAsync(dir, { ...options, stats }, 0))
        );
    }

    options.onProgress?.({
        ...stats,
        currentPath: '',
    });

    return result;
}

module.exports = {
    scanAll,
    checkFolderAvailability,
    scanAllAsync,
};
