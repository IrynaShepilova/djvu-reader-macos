// src/app.js
const express = require("express");
const cors = require("cors");
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const booksDir = path.join(process.env.HOME, 'Downloads');


// middlewares
app.use(cors());
app.use(express.json());

app.use('/books', express.static(booksDir));


// test route
app.get("/", (req, res) => {
    res.send("📚 Node backend works!");
});

// book route
app.get('/api/books', (req, res) => {
    const files = fs.readdirSync(booksDir).filter(f => f.toLowerCase().endsWith('.djvu'));
    const items = files.map((name, i) => ({
        id: i + 1,
        title: path.parse(name).name,
        filename: name,
        url: `/books/${encodeURIComponent(name)}`
    }));
    res.json(items);
});

app.listen(PORT, () => {
    console.log(`🚀 Backend running  on http://localhost:${PORT}`);
});
