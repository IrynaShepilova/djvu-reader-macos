const express = require('express');

const {
    addScanFolder,
    getScanFolders,
    removeScanFolder,
    updateScanFolder,
    updateScanFolderStatus,
} = require('../services/settings-store');

const { checkFolderAvailability } = require('../services/scanner');

const router = express.Router();

router.get('/api/scan-folders', (req, res) => {
    res.json(getScanFolders());
});

router.post('/api/scan-folders', (req, res) => {
    const { path } = req.body || {};

    if (!path || typeof path !== 'string') {
        return res.status(400).json({ error: 'path is required' });
    }

    const folder = addScanFolder(path);

    if (!folder) {
        return res.status(409).json({ error: 'Folder already exists' });
    }

    res.json({
        ok: true,
        folder,
    });
});

router.post('/api/scan-folders/check/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);

    const folders = getScanFolders();
    const folder = folders.find(f => f.id === id);

    if (!folder) {
        return res.status(404).json({ error: 'Scan folder not found' });
    }

    const result = checkFolderAvailability(folder.path);

    const updated = updateScanFolderStatus(id, {
        status: result.status,
        errorMessage: result.errorMessage,
        lastCheckedAt: new Date().toISOString(),
    });

    res.json({
        ok: true,
        folder: updated,
    });
});

router.patch('/api/scan-folders/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const { enabled } = req.body || {};

    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const updated = updateScanFolder(id, { enabled });

    if (!updated) {
        return res.status(404).json({ error: 'Scan folder not found' });
    }

    res.json({
        ok: true,
        folder: updated,
    });
});

router.delete('/api/scan-folders/:id', (req, res) => {
    const id = decodeURIComponent(req.params.id);

    const removed = removeScanFolder(id);

    if (removed === null) {
        return res.status(404).json({ error: 'Scan folder not found' });
    }

    if (removed === false) {
        return res.status(400).json({ error: 'Default folders cannot be removed' });
    }

    res.json({
        ok: true,
        folder: removed,
    });
});

module.exports = router;
