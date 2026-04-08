const fs = require('fs');
const path = require('path');

const { ensureDirExists, libraryFile } = require('../config/paths');

function readLibrary() {
    try {
        if (!fs.existsSync(libraryFile)) return [];
        const raw = fs.readFileSync(libraryFile, 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function writeLibrary(items) {
    ensureDirExists(path.dirname(libraryFile));
    fs.writeFileSync(libraryFile, JSON.stringify(items, null, 2), 'utf8');
}

module.exports = {
    readLibrary,
    writeLibrary,
};
