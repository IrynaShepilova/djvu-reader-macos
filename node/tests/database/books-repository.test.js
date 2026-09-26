const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const test = require('node:test');

const { createBooksRepository } = require('../../src/database/books-repository');

test('lists invalid books when they are inside an enabled scan folder', () => {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE books (
            id TEXT PRIMARY KEY,
            full_path TEXT NOT NULL,
            invalid INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE book_covers (book_id TEXT PRIMARY KEY);
        CREATE TABLE scan_folders (path TEXT NOT NULL, enabled INTEGER NOT NULL);
    `);

    db.prepare('INSERT INTO scan_folders (path, enabled) VALUES (?, ?)')
        .run('/library', 1);
    db.prepare('INSERT INTO books (id, full_path, invalid) VALUES (?, ?, ?)')
        .run('readable', '/library/readable.djvu', 0);
    db.prepare('INSERT INTO books (id, full_path, invalid) VALUES (?, ?, ?)')
        .run('invalid', '/library/invalid.djvu', 1);
    db.prepare('INSERT INTO books (id, full_path, invalid) VALUES (?, ?, ?)')
        .run('outside', '/other/outside.djvu', 1);

    const books = createBooksRepository(db).getAll();

    assert.deepEqual(books.map(book => book.id).sort(), ['invalid', 'readable']);
});
