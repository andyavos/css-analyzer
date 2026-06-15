'use strict';
/**
 * reporters/index.js
 * Text and JSON report formatters.
 */

const path = require('path');

// ─── Text Reporter ────────────────────────────────────────────────────────────

function printTextReport(report, opts = {}) {
    const { threshold = 0 } = opts;
    const hr = '─'.repeat(60);

    console.log('\n' + hr);
    console.log('  SCSS Usage Analysis Report');
    console.log(hr);
    console.log(`  Directory : ${report.directory}`);
    console.log(`  React files scanned  : ${report.reactFilesCount}`);
    console.log(`  SCSS files scanned   : ${report.scssFilesCount}`);
    console.log(`  Total SCSS classes   : ${report.totalScssClasses}`);
    console.log(`  Used in React        : ${report.totalUsedClasses}`);
    console.log(`  Unused classes       : ${report.unusedClassesCount}`);
    if (report.ghostClassesCount > 0) {
        console.log(`  Ghost classes (used but never defined in SCSS): ${report.ghostClassesCount}`);
    }
    if (report.dynamicPatternCount > 0) {
        console.log(`  Dynamic class patterns detected: ${report.dynamicPatternCount}`);
    }
    console.log(hr);

    // ── Unused classes grouped by file ────────────────────────────────────────
    if (report.unusedClasses.length === 0) {
        console.log('\n✓ No unused classes found (based on static analysis).\n');
    } else {
        const byFile = _groupByFile(report.unusedClasses, 'definedIn', threshold);
        console.log(`\n⚠  Unused classes${threshold > 0 ? ` (threshold: used < ${threshold})` : ''}:`);
        for (const [file, classes] of Object.entries(byFile)) {
            console.log(`\n  ${file}  (${classes.length} unused)`);
            classes.forEach(c => {
                const suffix = c.usageCount > 0 ? ` — used ${c.usageCount}x in React` : '';
                console.log(`    · ${c.className}${suffix}`);
            });
        }
        console.log('');
    }

    // ── Ghost classes ──────────────────────────────────────────────────────────
    if (report.ghostClasses && report.ghostClasses.length > 0) {
        const byFile = _groupByFile(report.ghostClasses, 'usedIn');
        console.log(`\n👻  Ghost classes (used in React, never defined in SCSS):`);
        for (const [file, classes] of Object.entries(byFile)) {
            console.log(`\n  ${file}  (${classes.length} ghost)`);
            classes.forEach(c => console.log(`    · ${c.className}`));
        }
        console.log('');
    }

    // ── Dynamic patterns ──────────────────────────────────────────────────────
    if (report.dynamicPatterns && report.dynamicPatterns.length > 0) {
        console.log(`\n⚡  Dynamic class patterns (may suppress false positives):`);
        report.dynamicPatterns.forEach(({ pattern, files }) => {
            console.log(`    · \`${pattern}\``);
            if (files.length <= 3) files.forEach(f => console.log(`        in ${f}`));
        });
        console.log('');
    }

    console.log(hr + '\n');
}

// ─── JSON Reporter ────────────────────────────────────────────────────────────

function printJsonReport(report) {
    console.log(JSON.stringify(report, null, 2));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Group an array of class objects by their first file path in `fileKey`.
 */
function _groupByFile(classes, fileKey, threshold = 0) {
    const map = {};
    for (const cls of classes) {
        if (threshold > 0 && (cls.usageCount ?? 0) >= threshold) continue;
        const files = cls[fileKey] || ['(unknown)'];
        const primary = files[0];
        if (!map[primary]) map[primary] = [];
        map[primary].push(cls);
    }
    // Sort each bucket alphabetically
    for (const f of Object.keys(map)) {
        map[f].sort((a, b) => a.className.localeCompare(b.className));
    }
    return map;
}

module.exports = { printTextReport, printJsonReport };
