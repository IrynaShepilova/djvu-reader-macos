const fs = require('fs');

const db = require('../database/database');

const folders = settings.scanFolders ?? [];

const insertFolder = db.prepare(`
    INSERT INTO scan_folders (
        id,
        path,
        enabled,
        type,
        status,
        error_message,
        last_checked_at
    ) VALUES (
        @id,
        @path,
        @enabled,
        @type,
        @status,
        @errorMessage,
        @lastCheckedAt
    )
`);

const migrateFolders = db.transaction((items) => {
    for (const folder of items) {
        insertFolder.run({
            id: folder.id,
            path: folder.path,
            enabled: folder.enabled ? 1 : 0,
            type: folder.type,
            status: folder.status ?? null,
            errorMessage: folder.errorMessage ?? null,
            lastCheckedAt: folder.lastCheckedAt ?? null,
        });
    }
});

migrateFolders(folders);

console.log(`Migrated ${folders.length} scan folders`);
