function createCoversRepository(db) {
    function getByBookId(bookId) {
        return db.prepare(`
            SELECT mime_type, data
            FROM book_covers
            WHERE book_id = ?
        `).get(bookId);
    }

    function set(bookId, mimeType, data) {
        return db.prepare(`
        INSERT INTO book_covers (
            book_id,
            mime_type,
            data
        )
        VALUES (?, ?, ?)
        ON CONFLICT(book_id) DO UPDATE SET
            mime_type = excluded.mime_type,
            data = excluded.data
    `).run(bookId, mimeType, data);
    }

    function remove(bookId) {
        return db.prepare(`
        DELETE FROM book_covers
        WHERE book_id = ?
    `).run(bookId);
    }

    return {
        getByBookId,
        set,
        remove,
    };
}

module.exports = { createCoversRepository };
