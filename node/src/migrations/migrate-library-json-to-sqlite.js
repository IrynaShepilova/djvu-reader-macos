const fs = require('fs');

const db = require('../services/database');
const { libraryFile } = require('../config/paths');

if (!fs.existsSync(libraryFile)) {
    console.log('library.json not found');
    process.exit(0);
}

const raw = fs.readFileSync(libraryFile, 'utf8');
const books = JSON.parse(raw);
    //.slice(0, 5);

const insertBook = db.prepare(`
    INSERT INTO books (
        id,
        full_path,
        title,
        author,
        filename,
        total_pages,
        last_opened_at,
        category,
        favorite
    ) VALUES (
        @id,
        @fullPath,
        @title,
        @author,
        @filename,
        @totalPages,
        @lastOpenedAt,
        @category,
        @favorite
    )
`);

const migrateBooks = db.transaction((items) => {
    for (const book of items) {
        insertBook.run({
            id: book.id,
            fullPath: book.fullPath,
            title: book.title,
            author: book.author ?? null,
            filename: book.filename,
            totalPages: book.totalPages ?? null,
            lastOpenedAt: book.lastOpenedAt ?? null,
            category: book.category ?? null,
            favorite: book.favorite ? 1 : 0,
        });
    }
});

migrateBooks(books);

console.log(`Migrated ${books.length} books`);
