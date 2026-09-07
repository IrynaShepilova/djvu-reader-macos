const fs = require('fs');
const path = require('path');

const db = require('../services/database');
const { libraryFile, coversDir } = require('../config/paths');

const books = JSON.parse(fs.readFileSync(libraryFile, 'utf8'))
    .filter(book => book.cover);

const insertCover = db.prepare(`
    INSERT INTO book_covers (
        book_id,
        mime_type,
        data
    ) VALUES (
        @bookId,
        @mimeType,
        @data
    )
`);

const migrateCovers = db.transaction((items) => {
    for (const book of items) {
        const filename = path.basename(book.cover);
        const coverPath = path.join(coversDir, filename);

        if (!fs.existsSync(coverPath)) {
            console.warn(`Cover not found: ${coverPath}`);
            continue;
        }

        const extension = path.extname(filename).toLowerCase();

        const mimeType = extension === '.png'
            ? 'image/png'
            : 'image/jpeg';

        insertCover.run({
            bookId: book.id,
            mimeType,
            data: fs.readFileSync(coverPath),
        });
    }
});

migrateCovers(books);

console.log(`Processed ${books.length} covers`);
