# DJVU Reader for MacOS

A lightweight DJVU reader built with Angular and Node.js.
Electron integration is planned.

## Features
- 📚 Library with tile & list views
- 📖 Reading progress
- 🗂 Tabs & Home navigation
- 🔄 Remembers last page
- ⚡ Fast local scanning
- 🖼 Cover previews

## Tech stack
- Angular
- Node.js (Express)
- DjVu.js

### Architecture

The reader is designed with extensibility in mind.

At the moment, it uses a **full render mode**, where all pages are decoded and rendered as images.
This simplifies navigation, scrolling, and progress calculation.

For large documents, a **virtual scrolling mode** is planned.
It will render only visible pages and reuse page containers to reduce memory usage.

The rendering strategy is isolated from the rest of the application, allowing future optimizations without major refactoring.


### Backend

A local Node.js (Express) backend is used to handle filesystem-related tasks that are not suitable for the browser:
- scanning local folders for DJVU files
- serving files to the reader
- persisting library metadata (library.json)
- managing book covers and extracted metadata (e.g. total pages)

The application is designed as a local-first app.


## Roadmap
- ⏳ Electron desktop wrapper
- 📁 Configurable scan folders (add/remove folders, depth control)
- 🧩 Book actions
  - rename / edit title and description
  - manage covers
  - rescan / refresh metadata (e.g. total pages)
  - remove from library (without deleting the file)
- 🏷️ Tags / categories and filtering / sorting
- 🕘 Recently opened books
- 🚀 Virtual scrolling renderer for large documents
- 🔀 Sorting options

> Status: active development
