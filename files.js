'use strict';
/**
 * utils/files.js
 * Fast file discovery using fast-glob when available, with a safe recursive fallback.
 */

const fs = require('fs');
const path = require('path');

let fg = null;
try { fg = require('fast-glob'); } catch (e) { /* optional */ }

const DEFAULT_IGNORE = new Set(['node_modules', 'build', 'dist', '.git', '.cache', 'coverage', '__mocks__']);

/**
 * @param {string}   rootDir
 * @param {string[]} extensions  e.g. ['.js', '.jsx']
 * @param {Set}      ignoreDirs
 * @returns {string[]} absolute paths
 */
function getFiles(rootDir, extensions, ignoreDirs = DEFAULT_IGNORE) {
    const exts = new Set(extensions);

    if (fg) {
        const patterns = Array.from(exts).map(e => `**/*${e}`);
        return fg.sync(patterns, {
            cwd: rootDir,
            absolute: true,
            suppressErrors: true,
            dot: false,
            ignore: Array.from(ignoreDirs).map(d => `**/${d}/**`),
        });
    }

    // Fallback: recursive fs walk
    const results = [];
    (function walk(dir) {
        let items;
        try { items = fs.readdirSync(dir); } catch (e) { return; }
        for (const item of items) {
            const full = path.join(dir, item);
            let stat;
            try { stat = fs.statSync(full); } catch (e) { continue; }
            if (stat.isDirectory()) {
                if (!ignoreDirs.has(item)) walk(full);
            } else if (exts.has(path.extname(item))) {
                results.push(full);
            }
        }
    })(rootDir);
    return results;
}

module.exports = { getFiles, DEFAULT_IGNORE };
