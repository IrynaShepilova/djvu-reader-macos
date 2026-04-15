const swaggerJSDoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'DJVU Reader API',
            version: '1.0.0',
            description: 'API for local DJVU Reader backend',
        },
        servers: [
            {
                url: 'http://localhost:3000',
            },
        ],
        tags: [
            { name: 'Health', description: 'Service health endpoints' },
            { name: 'Scan Folders', description: 'Manage folders used for scanning books' },
            { name: 'Books', description: 'Books library and metadata' },
            { name: 'Scan', description: 'Library scanning operations' },
            { name: 'Covers', description: 'Book cover upload and retrieval' },
        ],
        paths: {
            '/api/health': {
                get: {
                    tags: ['Health'],
                    summary: 'Health check',
                    responses: {
                        200: {
                            description: 'Backend is alive',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            ok: { type: 'boolean', example: true },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },

            '/api/scan-folders': {
                get: {
                    tags: ['Scan Folders'],
                    summary: 'Get scan folders',
                    responses: {
                        200: {
                            description: 'List of scan folders',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'array',
                                        items: {
                                            $ref: '#/components/schemas/ScanFolder',
                                        },
                                    },
                                },
                            },
                        },
                    },
                },

                post: {
                    tags: ['Scan Folders'],
                    summary: 'Add scan folder',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['path'],
                                    properties: {
                                        path: {
                                            type: 'string',
                                            example: '/Users/iryna/Documents',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'Folder added',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            ok: { type: 'boolean', example: true },
                                            folder: {
                                                $ref: '#/components/schemas/ScanFolder',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        400: {
                            description: 'Validation error',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                        409: {
                            description: 'Folder already exists',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                    },
                },
            },

            '/api/scan-folders/{id}': {
                patch: {
                    tags: ['Scan Folders'],
                    summary: 'Enable or disable scan folder',
                    parameters: [
                        {
                            name: 'id',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['enabled'],
                                    properties: {
                                        enabled: {
                                            type: 'boolean',
                                            example: false,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'Folder updated',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            ok: { type: 'boolean', example: true },
                                            folder: {
                                                $ref: '#/components/schemas/ScanFolder',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        400: {
                            description: 'Validation error',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                        404: {
                            description: 'Folder not found',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                    },
                },

                delete: {
                    tags: ['Scan Folders'],
                    summary: 'Remove custom scan folder',
                    parameters: [
                        {
                            name: 'id',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    responses: {
                        200: {
                            description: 'Folder removed',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            ok: { type: 'boolean', example: true },
                                            folder: {
                                                $ref: '#/components/schemas/ScanFolder',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        400: {
                            description: 'Default folders cannot be removed',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                        404: {
                            description: 'Folder not found',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                    },
                },
            },

            '/api/scan-folders/check/{id}': {
                post: {
                    tags: ['Scan Folders'],
                    summary: 'Check folder availability',
                    parameters: [
                        {
                            name: 'id',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    responses: {
                        200: {
                            description: 'Folder checked',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            ok: { type: 'boolean', example: true },
                                            folder: {
                                                $ref: '#/components/schemas/ScanFolder',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        404: {
                            description: 'Folder not found',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                    },
                },
            },

            '/api/books': {
                get: {
                    tags: ['Books'],
                    summary: 'Get books library',
                    responses: {
                        200: {
                            description: 'List of books',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'array',
                                        items: {
                                            $ref: '#/components/schemas/Book',
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },

            '/api/books/file/{id}': {
                get: {
                    tags: ['Books'],
                    summary: 'Download/open a DJVU file by book id',
                    parameters: [
                        {
                            name: 'id',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    responses: {
                        200: {
                            description: 'DJVU file stream',
                            content: {
                                'application/octet-stream': {
                                    schema: {
                                        type: 'string',
                                        format: 'binary',
                                    },
                                },
                            },
                        },
                        404: {
                            description: 'Book or file not found',
                        },
                    },
                },
            },

            '/api/books/{id}/meta': {
                patch: {
                    tags: ['Books'],
                    summary: 'Update book metadata',
                    parameters: [
                        {
                            name: 'id',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        totalPages: {
                                            type: 'integer',
                                            example: 248,
                                            nullable: true,
                                        },
                                        lastOpenedAt: {
                                            type: 'string',
                                            format: 'date-time',
                                            example: '2026-04-16T19:30:00.000Z',
                                            nullable: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'Metadata updated',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            ok: { type: 'boolean', example: true },
                                            id: { type: 'string', example: '/Users/iryna/Books/test.djvu' },
                                            totalPages: {
                                                type: 'integer',
                                                nullable: true,
                                                example: 248,
                                            },
                                            lastOpenedAt: {
                                                type: 'string',
                                                format: 'date-time',
                                                nullable: true,
                                                example: '2026-04-16T19:30:00.000Z',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        400: {
                            description: 'Validation error',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                        404: {
                            description: 'Book not found',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                    },
                },
            },

            '/api/books/scan': {
                post: {
                    tags: ['Scan'],
                    summary: 'Scan enabled folders and merge found books into library',
                    responses: {
                        200: {
                            description: 'Scan completed',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            added: { type: 'integer', example: 3 },
                                            total: { type: 'integer', example: 42 },
                                            newBooks: {
                                                type: 'array',
                                                items: {
                                                    $ref: '#/components/schemas/ScannedBookResult',
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },

            '/api/books/scan/status': {
                get: {
                    tags: ['Scan'],
                    summary: 'Get current scan status',
                    responses: {
                        200: {
                            description: 'Scan state',
                            content: {
                                'application/json': {
                                    schema: {
                                        $ref: '#/components/schemas/ScanState',
                                    },
                                },
                            },
                        },
                    },
                },
            },

            '/api/books/scan/start': {
                post: {
                    tags: ['Scan'],
                    summary: 'Start async library scan',
                    responses: {
                        200: {
                            description: 'Scan started or already running',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            ok: { type: 'boolean', example: true },
                                            alreadyRunning: {
                                                type: 'boolean',
                                                example: false,
                                                nullable: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },

            '/api/books/{id}/cover': {
                post: {
                    tags: ['Covers'],
                    summary: 'Upload custom cover for book',
                    parameters: [
                        {
                            name: 'id',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'multipart/form-data': {
                                schema: {
                                    type: 'object',
                                    required: ['cover'],
                                    properties: {
                                        cover: {
                                            type: 'string',
                                            format: 'binary',
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'Cover uploaded',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            ok: { type: 'boolean', example: true },
                                            coverUrl: {
                                                type: 'string',
                                                example: '/api/covers/abc123.jpg',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        400: {
                            description: 'No cover file provided',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                        404: {
                            description: 'Book not found',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                                },
                            },
                        },
                    },
                },
            },

            '/api/covers/{file}': {
                get: {
                    tags: ['Covers'],
                    summary: 'Get cover image by filename',
                    parameters: [
                        {
                            name: 'file',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    responses: {
                        200: {
                            description: 'JPEG image stream',
                            content: {
                                'image/jpeg': {
                                    schema: {
                                        type: 'string',
                                        format: 'binary',
                                    },
                                },
                            },
                        },
                        404: {
                            description: 'Cover not found',
                        },
                    },
                },
            },

        },

        components: {
            schemas: {
                ErrorResponse: {
                    type: 'object',
                    properties: {
                        error: {
                            type: 'string',
                            example: 'Book not found',
                        },
                    },
                },

                ScanFolder: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', example: 'default-books' },
                        path: { type: 'string', example: '/Users/iryna/Books' },
                        enabled: { type: 'boolean', example: true },
                        type: { type: 'string', example: 'default' },
                        status: { type: 'string', example: 'available' },
                        errorMessage: {
                            type: 'string',
                            nullable: true,
                            example: null,
                        },
                        lastCheckedAt: {
                            type: 'string',
                            nullable: true,
                            example: '2026-04-16T10:00:00.000Z',
                        },
                    },
                },

                Book: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'string',
                            example: '/Users/iryna/Books/example.djvu',
                        },
                        fullPath: {
                            type: 'string',
                            example: '/Users/iryna/Books/example.djvu',
                        },
                        title: {
                            type: 'string',
                            example: 'example',
                        },
                        filename: {
                            type: 'string',
                            example: 'example.djvu',
                        },
                        totalPages: {
                            type: 'integer',
                            nullable: true,
                            example: 248,
                        },
                        lastOpenedAt: {
                            type: 'string',
                            format: 'date-time',
                            nullable: true,
                            example: '2026-04-16T19:30:00.000Z',
                        },
                        cover: {
                            type: 'string',
                            nullable: true,
                            example: '/api/covers/abc123.jpg',
                        },
                        url: {
                            type: 'string',
                            example: '/api/books/file/%2FUsers%2Firyna%2FBooks%2Fexample.djvu',
                        },
                    },
                },

                ScannedBookResult: {
                    type: 'object',
                    properties: {
                        id: {
                            oneOf: [
                                { type: 'integer', example: 12 },
                                { type: 'string', example: '/Users/iryna/Books/new-book.djvu' },
                            ],
                        },
                        fullPath: {
                            type: 'string',
                            example: '/Users/iryna/Books/new-book.djvu',
                        },
                        title: {
                            type: 'string',
                            example: 'new-book',
                        },
                        filename: {
                            type: 'string',
                            example: 'new-book.djvu',
                        },
                    },
                },

                ScanState: {
                    type: 'object',
                    properties: {
                        running: { type: 'boolean', example: false },
                        done: { type: 'boolean', example: true },
                        percent: { type: 'integer', example: 100 },
                        processed: { type: 'integer', example: 42 },
                        total: { type: 'integer', example: 42 },
                        added: { type: 'integer', example: 3 },
                        message: { type: 'string', example: 'Done. Added 3' },
                    },
                },
            },
        },
    },
    apis: [],
};

const openapiSpec = swaggerJSDoc(options);

module.exports = {
    openapiSpec,
};
