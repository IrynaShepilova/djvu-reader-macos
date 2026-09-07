function createScanFoldersRepository(db) {
    function getAll() {
        return db.prepare(`
            SELECT *
            FROM scan_folders
        `).all();
    }

    function add(folder) {
        db.prepare(`
        INSERT INTO scan_folders (
            id,
            path,
            enabled,
            type,
            status,
            error_message,
            last_checked_at
        )
        VALUES (
            @id,
            @path,
            @enabled,
            @type,
            @status,
            @errorMessage,
            @lastCheckedAt
        )
    `).run(folder);
    }

    function update(id, patch) {
        const allowedFields = {
            enabled: 'enabled',
            status: 'status',
            errorMessage: 'error_message',
            lastCheckedAt: 'last_checked_at',
        };

        const entries = Object.entries(patch)
            .filter(([key]) => allowedFields[key]);

        if (entries.length === 0) {
            return;
        }

        const setClause = entries
            .map(([key]) => `${allowedFields[key]} = @${key}`)
            .join(', ');

        db.prepare(`
        UPDATE scan_folders
        SET ${setClause}
        WHERE id = @id
    `).run({
            id,
            ...patch,
        });
    }

    function remove(id) {
        return db.prepare(`
        DELETE FROM scan_folders
        WHERE id = ?
    `).run(id);
    }

    return {
        getAll,
        add,
        update,
        remove,
    };
}

module.exports = { createScanFoldersRepository };
