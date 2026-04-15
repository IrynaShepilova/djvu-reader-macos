// src/app.js
require('dotenv').config({
    path: process.env.NODE_ENV === 'production'
        ? '.env.production'
        : '.env'
});

// libs
const express = require("express");
const cors = require("cors");
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const swaggerUi = require('swagger-ui-express');

// modules
const { openapiSpec } = require('./docs/openapi');

// routes import
const scanFoldersRoutes = require('./routes/scan-folders');
const healthRoutes = require('./routes/health');
const booksRoutes = require('./routes/books');

const app = express();
const PORT = 3000;

const upload = multer({ storage: multer.memoryStorage() });

// middlewares
app.use(cors());
app.use(express.json());

// test route
// app.get("/", (req, res) => {
//     res.send("📚 Node backend works!");
// });

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

app.use(healthRoutes);
app.use(scanFoldersRoutes);
app.use(booksRoutes);

// book route

const uiDir = process.env.UI_DIR;

if (uiDir) {
    const indexHtml = path.join(uiDir, 'index.html');

    if (fs.existsSync(indexHtml)) {
        app.use(express.static(uiDir));

        // SPA fallback (do not catch /api)
        app.use((req, res, next) => {
            if (req.path.startsWith('/api/')) return next();
            res.sendFile(indexHtml);
        });
    } else {
        console.warn('[static] index.html not found:', indexHtml);
    }
} else {
    console.warn('[static] UI_DIR is not set; not serving UI');
}

app.listen(PORT, () => {
    console.log(`🚀 Backend running  on http://localhost:${PORT}`);
});
