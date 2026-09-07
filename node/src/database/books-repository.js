const insertBookSql = `
    INSERT OR IGNORE INTO books (
        id,
        full_path,
        title,
        author,
        filename,
        total_pages,
        last_opened_at,
        category,
        favorite,
        hidden,
        invalid
    )
    VALUES (
        @id,
        @fullPath,
        @title,
        @author,
        @filename,
        @totalPages,
        @lastOpenedAt,
        @category,
        @favorite,
        @hidden,
        @invalid
    )
`;

function toDbBook(book) {
    return {
        id: book.id,
        fullPath: book.fullPath,
        title: book.title,
        author: book.author ?? null,
        filename: book.filename,
        totalPages: book.totalPages ?? null,
        lastOpenedAt: book.lastOpenedAt ?? null,
        category: book.category ?? null,
        favorite: book.favorite ? 1 : 0,
        hidden: book.hidden ? 1 : 0,
        invalid: book.invalid ? 1 : 0,
    };
}

function createBooksRepository(db) {
    function getAll() {
        return db.prepare(`
            SELECT
                books.*,
                book_covers.book_id IS NOT NULL AS has_cover
            FROM books
            LEFT JOIN book_covers
                ON book_covers.book_id = books.id
            WHERE
                books.hidden = 0
                AND books.invalid = 0
                AND EXISTS (
                    SELECT 1
                    FROM scan_folders
                    WHERE scan_folders.enabled = 1
                      AND books.full_path LIKE scan_folders.path || '/%'
                )
        `).all();
    }

    function getOne() {
        return db.prepare(`
            SELECT
                books.*,
                book_covers.book_id IS NOT NULL AS has_cover
            FROM books
            LEFT JOIN book_covers
                ON book_covers.book_id = books.id
            LIMIT 1
        `).get();
    }

    function getById(id) {
        return db.prepare(`
        SELECT
            books.*,
            book_covers.book_id IS NOT NULL AS has_cover
        FROM books
        LEFT JOIN book_covers
            ON book_covers.book_id = books.id
        WHERE books.id = ?
    `).get(id);
    }

    function getByPath(fullPath) {
        return db.prepare(`
            SELECT
                books.*,
                book_covers.book_id IS NOT NULL AS has_cover
            FROM books
                     LEFT JOIN book_covers
                               ON book_covers.book_id = books.id
            WHERE books.full_path = ?
        `).get(fullPath);
    }

    function update(id, patch) {
        const allowedFields = {
            title: 'title',
            author: 'author',
            totalPages: 'total_pages',
            lastOpenedAt: 'last_opened_at',
            category: 'category',
            favorite: 'favorite',
            hidden: 'hidden',
            invalid: 'invalid',
        };

        const entries = Object.entries(patch)
            .filter(([key]) => allowedFields[key]);

        if (entries.length === 0) {
            return;
        }

        const setClause = entries
            .map(([key]) => `${allowedFields[key]} = @${key}`)
            .join(', ');

        return db.prepare(`
        UPDATE books
        SET ${setClause}
        WHERE id = @id
    `).run({
            id,
            ...patch,
        });
    }

    function add(book) {
        return db.prepare(insertBookSql).run(toDbBook(book));
    }

    function addMany(books) {
        const insert = db.prepare(insertBookSql);

        const insertMany = db.transaction((items) => {
            let added = 0;

            for (const book of items) {
                const result = insert.run(toDbBook(book));
                added += result.changes;
            }

            return added;
        });

        return insertMany(books);
    }

    function remove(id) {
        return db.prepare(`
        DELETE FROM books
        WHERE id = ?
    `).run(id);
    }

    return {
        getAll,
        getById,
        getByPath,
        update,
        add,
        addMany,
        remove,
    };
}

module.exports = { createBooksRepository };
