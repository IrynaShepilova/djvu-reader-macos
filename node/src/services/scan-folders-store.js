const db = require('../database/database');
const { createScanFoldersRepository } = require('../database/scan-folders-repository');

const scanFoldersRepository = createScanFoldersRepository(db);

function getScanFolders() {
    return scanFoldersRepository.getAll().map(toScanFolder);
}

function updateScanFolder(id, patch) {
    const current = getScanFolders().find(folder => folder.id === id);
    if (!current) return null;

    const allowedPatch = {
        ...(patch.enabled !== undefined && { enabled: patch.enabled ? 1 : 0 }),
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.errorMessage !== undefined && { errorMessage: patch.errorMessage }),
        ...(patch.lastCheckedAt !== undefined && { lastCheckedAt: patch.lastCheckedAt }),
    };

    scanFoldersRepository.update(id, allowedPatch);

    return {
        ...current,
        ...patch,
        id: current.id,
        path: current.path,
        type: current.type,
    };
}

function addScanFolder(folderPath) {
    const folders = getScanFolders();

    if (folders.some(folder => folder.path === folderPath)) {
        return null;
    }

    const newFolder = {
        id: `custom-${Date.now()}`,
        path: folderPath,
        enabled: true,
        type: 'custom',
        status: 'unknown',
        errorMessage: null,
        lastCheckedAt: null,
    };

    scanFoldersRepository.add({
        ...newFolder,
        enabled: 1,
    });

    return newFolder;
}

function removeScanFolder(id) {
    const folder = getScanFolders().find(folder => folder.id === id);
    if (!folder) return null;

    if (folder.type !== 'custom') {
        return false;
    }

    scanFoldersRepository.remove(id);

    return folder;
}

function updateScanFolderStatus(id, statusPatch) {
    return updateScanFolder(id, statusPatch);
}

function toScanFolder(row) {
    return {
        id: row.id,
        path: row.path,
        enabled: Boolean(row.enabled),
        type: row.type,
        status: row.status,
        errorMessage: row.error_message,
        lastCheckedAt: row.last_checked_at,
    };
}

module.exports = {
    addScanFolder,
    getScanFolders,
    removeScanFolder,
    updateScanFolder,
    updateScanFolderStatus,
};
