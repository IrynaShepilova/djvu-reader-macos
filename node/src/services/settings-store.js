const fs = require('fs');
const path = require('path');
const os = require('os');

const { ensureDirExists, settingsFile } = require('../config/paths');

function createDefaultScanFolders() {
    return [
        {
            id: 'default-downloads',
            path: path.join(os.homedir(), 'Downloads'),
            enabled: true,
            type: 'default',
            status: 'unknown',
        },
        {
            id: 'default-books',
            path: path.join(os.homedir(), 'Books'),
            enabled: true,
            type: 'default',
            status: 'unknown',
        },
    ];
}

function createDefaultSettings() {
    return {
        scanFolders: createDefaultScanFolders(),
    };
}

function readSettings() {
    try {
        if (!fs.existsSync(settingsFile)) {
            return createDefaultSettings();
        }

        const raw = fs.readFileSync(settingsFile, 'utf8');
        const data = JSON.parse(raw);

        if (!data || typeof data !== 'object') {
            return createDefaultSettings();
        }

        return {
            ...createDefaultSettings(),
            ...data,
            scanFolders: Array.isArray(data.scanFolders)
                ? data.scanFolders
                : createDefaultScanFolders(),
        };
    } catch {
        return createDefaultSettings();
    }
}

function writeSettings(settings) {
    ensureDirExists(path.dirname(settingsFile));
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
}

function getScanFolders() {
    return readSettings().scanFolders;
}

function saveScanFolders(scanFolders) {
    const settings = readSettings();
    settings.scanFolders = scanFolders;
    writeSettings(settings);
}

function ensureSettingsFile() {
    if (!fs.existsSync(settingsFile)) {
        writeSettings(createDefaultSettings());
        return;
    }

    const settings = readSettings();

    if (!Array.isArray(settings.scanFolders) || settings.scanFolders.length === 0) {
        writeSettings({
            ...settings,
            scanFolders: createDefaultScanFolders(),
        });
    }
}

function updateScanFolder(id, patch) {
    const settings = readSettings();
    const folders = settings.scanFolders || [];

    const index = folders.findIndex(folder => folder.id === id);
    if (index === -1) return null;

    const current = folders[index];

    const next = {
        ...current,
        ...patch,
        id: current.id,
        path: current.path,
        type: current.type,
    };

    folders[index] = next;
    settings.scanFolders = folders;
    writeSettings(settings);

    return next;
}

module.exports = {
    readSettings,
    writeSettings,
    getScanFolders,
    saveScanFolders,
    ensureSettingsFile,
    createDefaultScanFolders,
    updateScanFolder,
};
