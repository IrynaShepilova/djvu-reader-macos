function createSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS books (
            id TEXT PRIMARY KEY,
            full_path TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            author TEXT,
            filename TEXT NOT NULL,
            total_pages INTEGER,
            last_opened_at TEXT,
            category TEXT,
            favorite INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            hidden INTEGER NOT NULL DEFAULT 0,
            invalid INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS book_covers (
            book_id TEXT PRIMARY KEY,
            mime_type TEXT NOT NULL,
            data BLOB NOT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS scan_folders (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1,
            type TEXT NOT NULL,
            status TEXT,
            error_message TEXT,
            last_checked_at TEXT
        );
    `);

}

module.exports = { createSchema };
