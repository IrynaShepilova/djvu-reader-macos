const db = require('../database/database');
const { createBooksRepository } = require('../database/books-repository');

const fs = require('fs');

const booksRepository = createBooksRepository(db);

function getBooks() {
    return booksRepository.getAll().map(toBook);
}

function getBookById(id) {
    const row = booksRepository.getById(id);
    return row ? toBook(row) : null;
}

function toBook(row) {
    return {
        id: row.id,
        title: row.title,
        author: row.author,
        filename: row.filename,
        fullPath: row.full_path,
        totalPages: row.total_pages,
        createdAt: row.created_at,
        lastOpenedAt: row.last_opened_at,
        category: row.category,
        favorite: Boolean(row.favorite),
        hidden: Boolean(row.hidden),
        cover: row.has_cover
            ? `/api/books/${encodeURIComponent(row.id)}/cover`
            : undefined,
    };
}

function updateBook(id, patch) {
    const dbPatch = {
        ...patch,
        ...(patch.favorite !== undefined && {
            favorite: patch.favorite ? 1 : 0,
        }),
        ...(patch.invalid !== undefined && {
            invalid: patch.invalid ? 1 : 0,
        }),
        ...(patch.hidden !== undefined && {
            hidden: patch.hidden ? 1 : 0,
        }),
    };

    booksRepository.update(id, dbPatch);

    const row = booksRepository.getById(id);
    return row ? toBook(row) : null;
}

function addBook(book) {
    booksRepository.add(book);

    const row = booksRepository.getById(book.id);
    return row ? toBook(row) : null;
}

function addBookByPath(book) {
    booksRepository.add(book);

    const row = booksRepository.getByPath(book.fullPath);
    return row ? toBook(row) : null;
}

function addBooks(books) {
    return booksRepository.addMany(books);
}

function deleteBook(id) {
    const book = booksRepository.getById(id);

    if (!book) {
        return null;
    }

    booksRepository.remove(id);

    return toBook(book);
}

function hideBook(id) {
    return updateBook(id, {
        hidden: true,
    });
}

function getMissingBooks() {
    return booksRepository
        .getAll()
        .filter(book => !fs.existsSync(book.full_path))
        .map(toBook);
}

module.exports = {
    getBooks,
    getBookById,
    updateBook,
    addBook,
    addBookByPath,
    addBooks,
    deleteBook,
    hideBook,
    getMissingBooks,
};
