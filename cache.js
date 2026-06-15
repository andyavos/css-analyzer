'use strict';
/**
 * utils/cache.js
 * Lightweight mtime-based disk cache so repeated runs skip re-parsing unchanged files.
 * Cache is stored as a single JSON file at <rootDir>/.scss-analyzer-cache.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_VERSION = 2; // bump when cache schema changes

class FileCache {
    constructor(rootDir, enabled = true) {
        this.enabled = enabled;
        this.cachePath = path.join(rootDir, '.scss-analyzer-cache.json');
        this._store = {};
        if (enabled) this._load();
    }

    _load() {
        try {
            const raw = fs.readFileSync(this.cachePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.version === CACHE_VERSION) {
                this._store = parsed.entries || {};
            }
        } catch (e) {
            this._store = {};
        }
    }

    save() {
        if (!this.enabled) return;
        try {
            fs.writeFileSync(
                this.cachePath,
                JSON.stringify({ version: CACHE_VERSION, entries: this._store }, null, 2)
            );
        } catch (e) {
            // non-fatal
        }
    }

    /**
     * Get cached result for a file.
     * Returns null if file has changed or is not cached.
     */
    get(filePath) {
        if (!this.enabled) return null;
        const entry = this._store[filePath];
        if (!entry) return null;
        const mtime = _mtime(filePath);
        if (mtime !== entry.mtime) return null;
        return entry.value;
    }

    /**
     * Store result for a file.
     */
    set(filePath, value) {
        if (!this.enabled) return;
        this._store[filePath] = {
            mtime: _mtime(filePath),
            value,
        };
    }
}

function _mtime(filePath) {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch (e) {
        return 0;
    }
}

module.exports = { FileCache };
