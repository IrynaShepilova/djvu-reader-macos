# DJVU Reader for MacOS

A lightweight DJVU reader built with Angular, Node.js, and Electron.

## Features

- 📚 Local library with tile and list views
- 📖 Reading progress with exact page position restoration
- 🗂 Multiple draggable book tabs and Home navigation
- 📁 Configurable scan folders, including network locations
- 🔄 Library scanning and refresh
- 🖼 Cover previews
- ⭐ Favorites
- ✏️ Book metadata editing
- 🙈 Hide and remove books from the library
- 🔎 Missing file detection and library cleanup
- 🔀 Sorting by title, last opened, category, directory, and date added
- 📂 Grouping books by directory
- 📥 Open or add individual files with native macOS file picker
- 💾 Persistent local library stored in SQLite
- 📖 Single-page and two-page reading modes
- 🔎 Library search
- 📄 PDF support
- 🧩 Unified document abstraction for DJVU and PDF

## Tech stack

- Angular
- TypeScript
- Node.js / Express
- Electron
- SQLite / better-sqlite3
- DjVu.js

## Architecture

The application consists of three main parts:

- **Angular frontend** — library, reader, tabs, navigation, and UI state
- **Node.js / Express backend** — filesystem access, scanning, metadata, covers, and library API
- **Electron desktop shell** — native macOS integration, file and folder selection, and application lifecycle

Library data is persisted locally in **SQLite**. The backend uses a repository-based data access layer for books, covers, and scan folders.

The application is designed as a local-first desktop app and does not require a remote backend.

### Reader

DJVU documents are decoded with DjVu.js.

The reader currently supports:
- single-page and two-page reading modes
- page navigation and thumbnails
- reading progress
- exact reading position restoration
- multiple open books with draggable tabs

Rendering performance for large documents is planned to be improved by loading and retaining only the pages needed around the current reading position.

### Library

The library can be populated in two ways:

- scanning configured folders for DJVU files
- opening files directly with the native macOS file picker

Selecting a single file opens it and automatically adds it to the library if necessary. Selecting multiple files adds them to the library without opening them.

Books remain linked to their original files on disk. Missing files can be detected, hidden, or removed from the library without deleting the source files.

## Roadmap

- 🔖Bookmarks
- 📝Notes
- 🚀 More efficient rendering for large documents
- 🏷️ Extended tags and categories
- 🌍 Internationalization
- 🤖 AI-assisted study tools
  - explain the current page or task
  - hints and guided solutions
  - solution checking
  - task ↔ answer navigation
- 🔊 Text-to-speech
- 🧠 Book-wide search and AI assistance

> Status: active development

<img width="1330" height="771" alt="Screenshot 2026-09-27 at 00 50 50" src="https://github.com/user-attachments/assets/c5c3b888-45ff-4efc-9c19-2adde0cedb8b" />
<img width="1348" height="778" alt="Screenshot 2026-09-27 at 00 52 48" src="https://github.com/user-attachments/assets/ee9840f2-153a-4e2e-906f-dfd6fc27b14d" />





