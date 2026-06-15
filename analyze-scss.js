#!/usr/bin/env node
'use strict';
/**
 * analyze-scss.js
 *
 * SCSS Usage Analyzer — finds unused CSS classes across a React codebase.
 *
 * Usage:
 *   node analyze-scss.js [options] [directory]
 *
 * Options:
 *   --json              Output as JSON
 *   --dir <path>        Target directory (alternative to positional arg)
 *   --threshold <n>     Also flag classes used fewer than n times in React (default: 0 = off)
 *   --no-cache          Disable the mtime-based file cache
 *   --watch             Re-run analysis on file changes
 *
 * Dependencies (required):
 *   npm install sass @babel/parser @babel/traverse
 *
 * Dependencies (optional, improve accuracy):
 *   npm install postcss postcss-selector-parser fast-glob
 */

const fs   = require('fs');
const path = require('path');

const { extractClassesFromScssFile } = require('./extractors/scss');
const { extractClassesFromReactFile } = require('./extractors/react');
const { getFiles }                    = require('./utils/files');
const { FileCache }                   = require('./utils/cache');
const { printTextReport, printJsonReport } = require('./reporters/index');

const REACT_EXTS = ['.js', '.jsx', '.ts', '.tsx'];
const SCSS_EXTS  = ['.scss', '.css'];

// ─── Core Analyzer ───────────────────────────────────────────────────────────

function analyzeScssUsage(directory, opts = {}) {
    const { noCache = false, threshold = 0 } = opts;

    const resolvedDir = path.resolve(directory);
    if (!fs.existsSync(resolvedDir)) {
        throw new Error(`Directory does not exist: ${resolvedDir}`);
    }
    if (!fs.statSync(resolvedDir).isDirectory()) {
        throw new Error(`Path is not a directory: ${resolvedDir}`);
    }

    const cache = new FileCache(resolvedDir, !noCache);

    // ── 1. Discover files ──────────────────────────────────────────────────────
    const reactFiles = getFiles(resolvedDir, REACT_EXTS);
    const scssFiles  = getFiles(resolvedDir, SCSS_EXTS);

    if (reactFiles.length === 0) console.warn('Warning: No React files (.js/.jsx/.ts/.tsx) found.');
    if (scssFiles.length  === 0) console.warn('Warning: No SCSS/CSS files found.');

    // ── 2. Extract SCSS classes ────────────────────────────────────────────────
    // Map<className → Set<relPath>>
    const allScssClasses = new Map();

    for (const file of scssFiles) {
        const relPath = path.relative(resolvedDir, file);

        let classes = cache.get(file);
        if (!classes) {
            classes = Array.from(extractClassesFromScssFile(file, resolvedDir));
            cache.set(file, classes);
        }

        for (const cls of classes) {
            if (!allScssClasses.has(cls)) allScssClasses.set(cls, new Set());
            allScssClasses.get(cls).add(relPath);
        }
    }

    // ── 3. Extract React class usage ──────────────────────────────────────────
    // Map<className → Set<relPath>>  (static)
    // Map<pattern   → Set<relPath>>  (dynamic)
    const usedClasses      = new Map();
    const dynamicPatterns  = new Map();

    for (const file of reactFiles) {
        const relPath = path.relative(resolvedDir, file);

        let cached = cache.get(file);
        if (!cached) {
            const { staticClasses, dynamicPatterns: dp } = extractClassesFromReactFile(file);
            cached = {
                staticClasses: Array.from(staticClasses),
                dynamicPatterns: Array.from(dp),
            };
            cache.set(file, cached);
        }

        for (const cls of cached.staticClasses) {
            if (!usedClasses.has(cls)) usedClasses.set(cls, new Set());
            usedClasses.get(cls).add(relPath);
        }
        for (const pat of cached.dynamicPatterns) {
            if (!dynamicPatterns.has(pat)) dynamicPatterns.set(pat, new Set());
            dynamicPatterns.get(pat).add(relPath);
        }
    }

    cache.save();

    // ── 4. Classify results ───────────────────────────────────────────────────

    // Build a set of class prefixes from dynamic patterns so we can suppress
    // false positives: e.g. `btn-${size}` → prefix "btn-"
    const dynamicPrefixes = _buildDynamicPrefixes(dynamicPatterns);

    // Unused: defined in SCSS, not used statically, not covered by a dynamic prefix
    const unusedClasses = [];
    for (const [cls, files] of allScssClasses) {
        const usageCount = usedClasses.has(cls) ? usedClasses.get(cls).size : 0;
        const isDynamic  = _coveredByDynamic(cls, dynamicPrefixes);
        const belowThreshold = threshold > 0 && usageCount > 0 && usageCount < threshold;

        if (isDynamic) continue; // suppress — likely generated at runtime

        if (usageCount === 0 || belowThreshold) {
            unusedClasses.push({
                className:  cls,
                definedIn:  Array.from(files),
                usageCount,
                dynamic:    isDynamic,
            });
        }
    }

    // Ghost: used in React but never defined in SCSS
    const ghostClasses = [];
    for (const [cls, files] of usedClasses) {
        if (!allScssClasses.has(cls)) {
            ghostClasses.push({
                className: cls,
                usedIn:    Array.from(files),
            });
        }
    }

    // Sort outputs alphabetically
    unusedClasses.sort((a, b) => a.className.localeCompare(b.className));
    ghostClasses.sort((a, b) => a.className.localeCompare(b.className));

    const dynamicPatternsArr = Array.from(dynamicPatterns.entries()).map(([pattern, files]) => ({
        pattern,
        files: Array.from(files),
    }));

    return {
        directory:         resolvedDir,
        scssFilesCount:    scssFiles.length,
        reactFilesCount:   reactFiles.length,
        totalScssClasses:  allScssClasses.size,
        totalUsedClasses:  usedClasses.size,
        unusedClassesCount: unusedClasses.length,
        ghostClassesCount:  ghostClasses.length,
        dynamicPatternCount: dynamicPatternsArr.length,
        unusedClasses,
        ghostClasses,
        dynamicPatterns:   dynamicPatternsArr,
        // Full data for --json consumers
        allScssClasses: Array.from(allScssClasses.entries()).map(([cls, files]) => ({
            className: cls, definedIn: Array.from(files),
        })),
        usedClasses: Array.from(usedClasses.entries()).map(([cls, files]) => ({
            className: cls, usedIn: Array.from(files),
        })),
    };
}

// ─── Dynamic Pattern Helpers ─────────────────────────────────────────────────

/**
 * From dynamic patterns like "btn-${…}-active" extract the static prefix/suffix
 * segments so we can suppress classes like "btn-lg-active".
 */
function _buildDynamicPrefixes(dynamicPatterns) {
    const prefixes = [];
    for (const pattern of dynamicPatterns.keys()) {
        // Split on ${…} markers and record non-empty parts
        const parts = pattern.split('${…}').filter(Boolean);
        if (parts.length) prefixes.push(parts);
    }
    return prefixes;
}

function _coveredByDynamic(className, prefixes) {
    for (const parts of prefixes) {
        let pos = 0;
        let matched = true;
        for (const part of parts) {
            const idx = className.indexOf(part, pos);
            if (idx === -1) { matched = false; break; }
            pos = idx + part.length;
        }
        if (matched) return true;
    }
    return false;
}

// ─── Watch Mode ──────────────────────────────────────────────────────────────

function watchMode(directory, opts) {
    console.log(`\nWatch mode active. Monitoring: ${path.resolve(directory)}\n`);
    let debounce = null;

    function run() {
        console.clear();
        try {
            const report = analyzeScssUsage(directory, { ...opts, noCache: true });
            if (opts.json) printJsonReport(report);
            else printTextReport(report, opts);
        } catch (err) {
            console.error('Error:', err.message);
        }
        console.log('\nWaiting for changes…');
    }

    run();

    fs.watch(path.resolve(directory), { recursive: true }, (event, filename) => {
        if (!filename) return;
        const ext = path.extname(filename);
        if (![...REACT_EXTS, ...SCSS_EXTS].includes(ext)) return;
        clearTimeout(debounce);
        debounce = setTimeout(run, 300);
    });
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
    const argv = process.argv.slice(2);
    let directory = '.';
    let asJson    = false;
    let noCache   = false;
    let watch     = false;
    let threshold = 0;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--json')    { asJson  = true; }
        else if (a === '--no-cache') { noCache = true; }
        else if (a === '--watch')    { watch   = true; }
        else if ((a === '--dir' || a === '-d') && argv[i + 1]) { directory = argv[++i]; }
        else if (a === '--threshold' && argv[i + 1]) { threshold = parseInt(argv[++i], 10) || 0; }
        else if (!a.startsWith('--')) { directory = a; }
    }

    const opts = { noCache, threshold, json: asJson };

    if (watch) {
        watchMode(directory, opts);
    } else {
        try {
            const report = analyzeScssUsage(directory, opts);
            if (asJson) printJsonReport(report);
            else printTextReport(report, opts);
            process.exit(0);
        } catch (err) {
            console.error('Error:', err.message);
            process.exit(1);
        }
    }
}

module.exports = { analyzeScssUsage };
