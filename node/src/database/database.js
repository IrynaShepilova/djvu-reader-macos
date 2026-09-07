const Database = require('better-sqlite3');

const { dbFile } = require('../config/paths');
const { createSchema } = require('./schema');

const db = new Database(dbFile);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

createSchema(db);

module.exports = db;
