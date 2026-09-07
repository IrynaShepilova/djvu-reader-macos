const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { getBooks, getBookById, updateBook, addBook, addBookByPath, addBooks, deleteBook, hideBook, getMissingBooks} = require('../services/library-store');
const { getScanState, setScanState } = require('../services/scan-state');
const { scanAll, scanAllAsync, createBookFromPath, isDjvuFile } = require('../services/scanner');
const { getScanFolders } = require('../services/scan-folders-store');

const db = require('../database/database');
const { createBooksRepository } = require('../database/books-repository');
const booksRepository = createBooksRepository(db);

const { createCoversRepository } = require('../database/covers-repository');
const coversRepository = createCoversRepository(db);

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function getEnabledScanPaths() {
    return getScanFolders()
        .filter(f => f.enabled)
        .map(f => f.path);
}

function isBookInEnabledFolder(book, enabledPaths) {
    if (!book?.fullPath) return false;

    return enabledPaths.some(folderPath => {
        const normalizedFolder = path.resolve(folderPath);
        const normalizedBook = path.resolve(book.fullPath);

        return normalizedBook === normalizedFolder
            || normalizedBook.startsWith(normalizedFolder + path.sep);
    });
}

router.get('/api/books', (req, res) => {
    const result = getBooks().map(book => ({
        ...book,
        url: `/api/books/file/${encodeURIComponent(book.id)}`
    }));

    res.json(result);
});

router.get('/api/books/file/:id', (req, res) => {
    const book = getBookById(req.params.id);

    if (!book) {
        return res.status(404).json({ error: 'Book not found' });
    }

    if (!fs.existsSync(book.fullPath)) {
        return res.status(404).send('The book file is not available.');
    }

    res.sendFile(book.fullPath);
});

// router.post('/api/books/scan', (req, res) => {
//     const scanned = scanAll(getEnabledScanPaths());
//
//     const added = addBooks(scanned);
//
//     res.json({
//         added,
//         total: getBooks().length,
//     });
// });

router.get('/api/books/scan/status', (req, res) => {
    res.json(getScanState());
});

router.post('/api/books/scan/start', async (req, res) => {
    if (getScanState().running) {
        return res.json({ ok: true, alreadyRunning: true });
    }

    setScanState({
        running: true,
        done: false,
        percent: 0,
        processed: 0,
        total: 0,
        added: 0,
        message: 'Starting…'
    });

    setImmediate(() => runScan());

    res.json({ ok: true });
});

router.post('/api/books/:id/invalid', (req, res) => {
    const id = req.params.id;

    const book = updateBook(id, {
        invalid: true,
    });

    if (!book) {
        return res.status(404).json({ error: 'Book not found' });
    }

    res.json({
        ok: true,
        id,
        invalid: true,
    });
});

async function runScan() {
    let scanState = getScanState();

    try {
        const scanned = await scanAllAsync(getEnabledScanPaths(), {
            onProgress: ({ scannedEntries, foundBooks, currentPath }) => {
                const state = getScanState();

                setScanState({
                    ...state,
                    processed: scannedEntries,
                    total: 0,
                    percent: 0,
                    added: foundBooks,
                    message: currentPath
                        ? `Scanning… ${currentPath}`
                        : `Scanning… found ${foundBooks} books`,
                });
            },
        });

        const added = addBooks(scanned);

        const state = getScanState();

        setScanState({
            ...state,
            added,
            percent: 100,
            processed: scanned.length,
            total: scanned.length,
            message: `Done. Added ${added}`,
        });
    } catch (e) {
        const state = getScanState();

        setScanState({
            ...state,
            message: `Error: ${e?.message || e}`,
        });
    } finally {
        const state = getScanState();

        setScanState({
            ...state,
            running: false,
            done: true,
        });
    }
}

router.get('/api/books/:id/cover', (req, res) => {
    const cover = coversRepository.getByBookId(req.params.id);

    if (!cover) {
        return res.status(404).end();
    }

    res.setHeader('Content-Type', cover.mime_type);
    res.send(cover.data);
});

router.post('/api/books/:id/cover', upload.single('cover'), (req, res) => {
    const id = req.params.id;
    const book = getBookById(id);

    if (!book) {
        return res.status(404).json({ error: 'Book not found' });
    }

    if (!req.file?.buffer) {
        return res.status(400).json({ error: 'No cover file' });
    }

    coversRepository.set(
        id,
        req.file.mimetype,
        req.file.buffer
    );

    const coverUrl = `/api/books/${encodeURIComponent(id)}/cover`;

    res.json({
        ok: true,
        coverUrl,
    });
});

router.delete('/api/books/:id/cover', (req, res) => {
    const id = req.params.id;
    const book = getBookById(id);

    if (!book) {
        return res.status(404).json({ error: 'Book not found' });
    }

    coversRepository.remove(id);

    res.json({
        ok: true,
        id,
        cover: '',
    });
});

router.patch('/api/books/:id/meta', (req, res) => {
    const id = req.params.id;

    let patch;

    try {
        patch = normalizeBookMetaPatch(req.body);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'Nothing to update' });
    }

    const book = updateBook(id, patch);

    if (!book) {
        return res.status(404).json({ error: 'Book not found' });
    }

    res.json({
        ok: true,
        book,
    });
});

function normalizeBookMetaPatch(body = {}) {
    const patch = {};

    if (body.totalPages !== undefined && body.totalPages !== null) {
        const totalPages = Number(body.totalPages);

        if (!Number.isFinite(totalPages) || totalPages < 1) {
            throw new Error('totalPages must be a positive number');
        }

        patch.totalPages = Math.floor(totalPages);
    }

    if (body.lastOpenedAt !== undefined) {
        if (
            body.lastOpenedAt !== null &&
            (typeof body.lastOpenedAt !== 'string' || Number.isNaN(Date.parse(body.lastOpenedAt)))
        ) {
            throw new Error('lastOpenedAt must be a valid ISO date string or null');
        }

        patch.lastOpenedAt = body.lastOpenedAt;
    }

    if (body.title !== undefined) {
        if (typeof body.title !== 'string' || !body.title.trim()) {
            throw new Error('title must be a non-empty string');
        }

        patch.title = body.title.trim();
    }

    if (body.author !== undefined) {
        if (
            body.author !== null &&
            typeof body.author !== 'string'
        ) {
            throw new Error('author must be a string or null');
        }

        patch.author = body.author?.trim() || null;
    }

    if (body.favorite !== undefined) {
        if (typeof body.favorite !== 'boolean') {
            throw new Error('favorite must be a boolean');
        }

        patch.favorite = body.favorite;
    }

    return patch;
}

router.post('/api/books/add-by-path', (req, res) => {
    const { path: filePath } = req.body || {};

    if (!filePath) {
        return res.status(400).json({
            error: 'Path is required',
        });
    }

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({
            error: 'File not found',
        });
    }

    if (!isDjvuFile(filePath)) {
        return res.status(400).json({
            error: 'Not a DjVu file',
        });
    }

    const book = createBookFromPath(filePath);
    const savedBook = addBookByPath(book);

    res.json(savedBook);
});

router.delete('/api/books/:id', (req, res) => {
    const book = deleteBook(req.params.id);

    if (!book) {
        return res.status(404).json({ error: 'Book not found' });
    }

    res.json({
        ok: true,
        id: book.id,
    });
});

router.post('/api/books/:id/hide', (req, res) => {
    const book = hideBook(req.params.id);

    if (!book) {
        return res.status(404).json({ error: 'Book not found' });
    }

    res.json({
        ok: true,
        book,
    });
});

router.get('/api/books/missing', (req, res) => {
    const books = getMissingBooks();

    res.json({
        count: books.length,
        books,
    });
});

module.exports = router;
