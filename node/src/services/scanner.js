const fs = require('fs');
const path = require('path');

const MAX_SCAN_DEPTH = 3;

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
                id: fullPath,
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

module.exports = {
    scanAll,
    scanFolderRecursive,
};
