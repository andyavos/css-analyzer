#!/usr/bin/env node
/**
 * analyze-scss.js (improved)
 *
 * Improvements:
 * - Uses postcss + postcss-selector-parser (if available) to reliably collect class selectors
 * - Better extraction of className usage in React: supports string literals, template literals,
 *   clsx/classNames calls, arrays, object expressions, member expressions (styles.foo)
 * - Optionally uses fast-glob for faster file discovery; falls back to recursive fs scanning
 * - Collects multiple source locations per class (maps -> Sets)
 * - Provides JSON-friendly output with `--json` flag
 * - Graceful fallback when optional dependencies are not installed (prints warnings)
 *
 * Recommended deps:
 *   npm install sass @babel/parser @babel/traverse postcss postcss-selector-parser fast-glob
 *
 * The script is defensive and will still run without optional deps, but results may be less accurate.
 */

const fs = require('fs');
const path = require('path');
const sass = require('sass');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Try optional dependencies
let fg = null;
try { fg = require('fast-glob'); } catch (e) { /* optional */ }

let postcss = null;
let selectorParser = null;
try {
    postcss = require('postcss');
    selectorParser = require('postcss-selector-parser');
} catch (e) {
    // optional; we'll fall back to regex
}

// Utility: safe read
function safeRead(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (e) {
        console.warn(`Warning: couldn't read ${file}: ${e.message}`);
        return '';
    }
}

// File discovery: patterns or fallback recursion
function getFiles(rootDir, extensions, ignoreDirs = new Set(['node_modules', 'build', 'dist', '.git'])) {
    const exts = new Set(extensions);
    if (fg) {
        // fast-glob patterns
        const patterns = Array.from(exts).map(e => `**/*${e}`);
        const entries = fg.sync(patterns, {
            cwd: rootDir,
            absolute: true,
            suppressErrors: true,
            dot: false,
            ignore: Array.from(ignoreDirs).map(d => `**/${d}/**`)
        });
        return entries;
    }

    // fallback: recursive fs
    const results = [];
    function walk(dir) {
        let items;
        try { items = fs.readdirSync(dir); } catch (e) { return; }
        for (const item of items) {
            const full = path.join(dir, item);
            let stat;
            try { stat = fs.statSync(full); } catch (e) { continue; }
            if (stat.isDirectory()) {
                if (!ignoreDirs.has(item)) walk(full);
            } else {
                if (exts.has(path.extname(item))) results.push(full);
            }
        }
    }
    walk(rootDir);
    return results;
}

// Parse compiled CSS using postcss if available, else regex fallback
function extractScssClasses(scssContent, filePath) {
    const classes = new Set();

    try {
        const result = sass.compileString(scssContent, {
            loadPaths: [path.dirname(filePath)]
        });

        const cssContent = result.css.toString ? result.css.toString() : String(result.css);

        if (postcss && selectorParser) {
            const root = postcss.parse(cssContent, { from: undefined });
            root.walkRules(rule => {
                try {
                    selectorParser(selectors => {
                        selectors.walkClasses(classNode => {
                            if (classNode.value) classes.add(classNode.value);
                        });
                        // also capture class-like attributes (e.g., [class~="foo"])
                        selectors.walkAttributes(attrNode => {
                            if (attrNode.attribute === 'class' && attrNode.value) {
                                // value may be "foo" or "~='foo bar'"
                                attrNode.value.split(/\s+/).forEach(v => v && classes.add(v));
                            }
                        });
                    }).processSync(rule.selector);
                } catch (e) {
                    // ignore invalid selectors
                }
            });
        } else {
            // Fallback: conservative regex. This is less accurate than postcss.
            const classRegex = /\.([a-zA-Z0-9_-]+)(?=[\s\.\[:,{>+~#])/g;
            let match;
            while ((match = classRegex.exec(cssContent)) !== null) {
                if (match[1]) classes.add(match[1]);
            }
            // also catch .class { and .class, .class: and .class>
            const classRegex2 = /\.([a-zA-Z0-9_-]+)\s*[{:,>~]/g;
            while ((match = classRegex2.exec(cssContent)) !== null) {
                if (match[1]) classes.add(match[1]);
            }
        }
    } catch (error) {
        console.warn(`Warning: Error compiling SCSS file ${filePath}: ${error.message}`);
    }

    return classes;
}

// Helpers to collect static class names from AST expressions
function collectFromExpression(expr, classes, filePath) {
    // classes: Set to add to
    if (!expr) return;

    switch (expr.type) {
        case 'StringLiteral':
            expr.value.split(/\s+/).forEach(c => c && classes.add(c));
            break;
        case 'TemplateLiteral':
            expr.quasis.forEach(q => {
                q.value.raw.split(/\s+/).forEach(c => c && classes.add(c));
            });
            // try to extract string literal expressions inside template (rare)
            expr.expressions.forEach(e => collectFromExpression(e, classes, filePath));
            break;
        case 'BinaryExpression':
            // "a" + " " + "b"
            collectFromExpression(expr.left, classes, filePath);
            collectFromExpression(expr.right, classes, filePath);
            break;
        case 'ArrayExpression':
            expr.elements.forEach(el => collectFromExpression(el, classes, filePath));
            break;
        case 'ObjectExpression':
            // keys may be Identifier or StringLiteral; include keys with truthy static values
            expr.properties.forEach(prop => {
                if (prop.type === 'ObjectProperty') {
                    const keyName = prop.key.type === 'Identifier' ? prop.key.name :
                        (prop.key.type === 'StringLiteral' ? prop.key.value : null);
                    // only include if value is a literal true-ish (true or truthy literal)
                    if (keyName) {
                        if (prop.value.type === 'BooleanLiteral') {
                            if (prop.value.value === true) classes.add(keyName);
                        } else if (prop.value.type === 'NumericLiteral') {
                            if (prop.value.value !== 0) classes.add(keyName);
                        } else if (prop.value.type === 'StringLiteral') {
                            if (prop.value.value) classes.add(keyName);
                        } else {
                            // non-static value; we can't determine at compile-time - skip
                        }
                    }
                }
            });
            break;
        case 'ConditionalExpression':
            collectFromExpression(expr.consequent, classes, filePath);
            collectFromExpression(expr.alternate, classes, filePath);
            break;
        case 'CallExpression':
            // handle common helpers like clsx/classNames: args can be strings, arrays, objects
            if (expr.callee) {
                const calleeName = getCalleeName(expr.callee);
                if (['clsx', 'classNames', 'cx'].includes(calleeName)) {
                    expr.arguments.forEach(arg => collectFromExpression(arg, classes, filePath));
                } else {
                    // generic call: try to collect string-literal or template literal args
                    expr.arguments.forEach(arg => collectFromExpression(arg, classes, filePath));
                }
            }
            break;
        case 'Identifier':
            // identifier may reference a string constant or imported styles object: can't resolve reliably
            // but if it looks like "styles" used in MemberExpression elsewhere we'll catch MemberExpression
            // nothing to add for bare identifier
            break;
        case 'MemberExpression':
            // e.g., styles.foo or styles['foo'] => collect 'foo'
            if (!expr.computed && expr.property && expr.property.type === 'Identifier') {
                classes.add(expr.property.name);
            } else if (expr.computed && expr.property && expr.property.type === 'StringLiteral') {
                classes.add(expr.property.value);
            }
            break;
        default:
            // Unhandled nodes: attempt to traverse known subnodes
            if (expr.left) collectFromExpression(expr.left, classes, filePath);
            if (expr.right) collectFromExpression(expr.right, classes, filePath);
            if (expr.callee) collectFromExpression(expr.callee, classes, filePath);
            if (expr.arguments) expr.arguments.forEach(a => collectFromExpression(a, classes, filePath));
    }
}

function getCalleeName(callee) {
    if (!callee) return null;
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression') {
        if (callee.property.type === 'Identifier') return callee.property.name;
        if (callee.property.type === 'Literal') return String(callee.property.value);
    }
    return null;
}

// Extract classes used in React files
function extractReactClasses(reactContent, filePath) {
    const classes = new Set();

    let ast;
    try {
        ast = parser.parse(reactContent, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator']
        });
    } catch (error) {
        console.warn(`Warning: Error parsing React file ${filePath}: ${error.message}`);
        return classes;
    }

    traverse(ast, {
        JSXAttribute(path) {
            try {
                const name = path.node.name && path.node.name.name;
                if (name !== 'className' && name !== 'class') return;

                const val = path.node.value;
                if (!val) return;
                if (val.type === 'StringLiteral') {
                    val.value.split(/\s+/).forEach(c => c && classes.add(c));
                } else if (val.type === 'JSXExpressionContainer') {
                    collectFromExpression(val.expression, classes, filePath);
                } else if (val.type === 'JSXElement') {
                    // unlikely - ignore
                }
            } catch (e) {
                // ignore
            }
        },
        CallExpression(path) {
            try {
                const calleeName = getCalleeName(path.node.callee);
                if (['clsx', 'classNames', 'cx'].includes(calleeName)) {
                    path.node.arguments.forEach(arg => collectFromExpression(arg, classes, filePath));
                }
            } catch (e) { /* ignore */ }
        }
    });

    return classes;
}

// Main analyzer
function analyzeScssUsage(directory) {
    const resolvedDir = path.resolve(directory);
    if (!fs.existsSync(resolvedDir)) throw new Error(`Directory does not exist: ${resolvedDir}`);
    if (!fs.statSync(resolvedDir).isDirectory()) throw new Error(`Path is not a directory: ${resolvedDir}`);

    // Discover files
    const reactExts = ['.js', '.jsx', '.ts', '.tsx'];
    const scssExts = ['.scss'];

    const reactFiles = getFiles(resolvedDir, reactExts);
    const scssFiles = getFiles(resolvedDir, scssExts);

    if (reactFiles.length === 0) {
        console.warn('Warning: No React files (.js/.jsx/.ts/.tsx) found.');
    }
    if (scssFiles.length === 0) {
        console.warn('Warning: No SCSS files (.scss) found.');
    }

    // Map: className -> Set of scss files where defined
    const allScssClasses = new Map();
    scssFiles.forEach(file => {
        const content = safeRead(file);
        const classes = extractScssClasses(content, file);
        classes.forEach(cls => {
            if (!allScssClasses.has(cls)) allScssClasses.set(cls, new Set());
            allScssClasses.get(cls).add(file);
        });
    });

    // Map: className -> Set of react files where used
    const usedClasses = new Map();
    reactFiles.forEach(file => {
        const content = safeRead(file);
        const classes = extractReactClasses(content, file);
        classes.forEach(cls => {
            if (!usedClasses.has(cls)) usedClasses.set(cls, new Set());
            usedClasses.get(cls).add(file);
        });
    });

    // Unused classes: those defined in SCSS but not used in React
    const unusedClasses = new Map();
    allScssClasses.forEach((filesSet, cls) => {
        if (!usedClasses.has(cls)) unusedClasses.set(cls, filesSet);
    });

    return {
        directory: resolvedDir,
        scssFilesCount: scssFiles.length,
        reactFilesCount: reactFiles.length,
        totalScssClasses: allScssClasses.size,
        totalUsedClasses: usedClasses.size,
        unusedClassesCount: unusedClasses.size,
        unusedClasses: Array.from(unusedClasses.entries()).map(([cls, filesSet]) => ({
            className: cls,
            definedIn: Array.from(filesSet).map(f => path.relative(resolvedDir, f))
        })),
        // additional helpful data
        allScssClasses: Array.from(allScssClasses.entries()).map(([cls, files]) => ({
            className: cls,
            definedIn: Array.from(files).map(f => path.relative(resolvedDir, f))
        })),
        usedClasses: Array.from(usedClasses.entries()).map(([cls, files]) => ({
            className: cls,
            usedIn: Array.from(files).map(f => path.relative(resolvedDir, f))
        }))
    };
}

// CLI
function printTextReport(report) {
    console.log('\nSCSS Usage Analysis Report');
    console.log('--------------------------');
    console.log(`Analyzed directory: ${report.directory}`);
    console.log(`React files: ${report.reactFilesCount}`);
    console.log(`SCSS files: ${report.scssFilesCount}`);
    console.log(`Total SCSS classes found: ${report.totalScssClasses}`);
    console.log(`Total classes used in React: ${report.totalUsedClasses}`);
    console.log(`Number of unused classes: ${report.unusedClassesCount}`);

    if (report.unusedClasses.length > 0) {
        console.log('\nUnused classes and their locations:');
        report.unusedClasses.forEach(u => {
            console.log(`- ${u.className} (defined in: ${u.definedIn.join(', ')})`);
        });
    } else {
        console.log('\nNo unused classes found (based on static analysis).');
    }
}

function printJson(report) {
    console.log(JSON.stringify(report, null, 2));
}

// Entry
if (require.main === module) {
    const argv = process.argv.slice(2);
    let directory = '.';
    let asJson = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--json') asJson = true;
        else if (a === '--dir' && argv[i + 1]) { directory = argv[i + 1]; i++; }
        else if (!a.startsWith('--')) directory = a;
    }

    try {
        const report = analyzeScssUsage(directory);
        if (asJson) printJson(report);
        else printTextReport(report);
        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}
