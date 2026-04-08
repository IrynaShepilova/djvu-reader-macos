const fs = require('fs');
const path = require('path');
const os = require('os');

function resolvePath(p) {
    if (!p) return p;

    if (p.startsWith('~')) {
        return path.join(os.homedir(), p.slice(1));
    }

    return p;
}

function ensureDirExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

const libraryFile =
    resolvePath(process.env.LIBRARY_PATH) ||
    path.join(os.homedir(), '.djvu-reader', 'library.json');

const coversDir = path.join(path.dirname(libraryFile), 'covers');

ensureDirExists(coversDir);

module.exports = {
    ensureDirExists,
    libraryFile,
    coversDir,
};
