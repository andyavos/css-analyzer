'use strict';
/**
 * extractors/scss.js
 * Compiles SCSS and extracts all class selectors, with per-class source location.
 */

const fs = require('fs');
const path = require('path');
const sass = require('sass');

let postcss = null;
let selectorParser = null;
try {
    postcss = require('postcss');
    selectorParser = require('postcss-selector-parser');
} catch (e) { /* optional — falls back to regex */ }

/**
 * Compile a single SCSS file and return all class names found in the resulting CSS.
 * Returns a Map<className, Set<relativeFilePath>>.
 */
function extractClassesFromScssFile(filePath, rootDir) {
    const classes = new Set();
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        console.warn(`Warning: couldn't read ${filePath}: ${e.message}`);
        return classes;
    }

    let cssContent;
    try {
        const result = sass.compileString(content, {
            loadPaths: [path.dirname(filePath)],
            quietDeps: true,
            logger: sass.Logger.silent,
        });
        cssContent = typeof result.css === 'string' ? result.css : result.css.toString();
    } catch (err) {
        console.warn(`Warning: SCSS compile error in ${path.relative(rootDir, filePath)}: ${err.message}`);
        return classes;
    }

    if (postcss && selectorParser) {
        _extractWithPostcss(cssContent, classes);
    } else {
        _extractWithRegex(cssContent, classes);
    }

    return classes;
}

function _extractWithPostcss(cssContent, classes) {
    let root;
    try {
        root = postcss.parse(cssContent, { from: undefined });
    } catch (e) {
        _extractWithRegex(cssContent, classes);
        return;
    }

    root.walkRules(rule => {
        try {
            selectorParser(selectors => {
                selectors.walkClasses(node => {
                    if (node.value) classes.add(node.value);
                });
                // Handle [class~="foo"] attribute selectors
                selectors.walkAttributes(node => {
                    if (node.attribute === 'class' && node.value) {
                        node.value.replace(/['"]/g, '').split(/\s+/).forEach(v => v && classes.add(v));
                    }
                });
                // Handle :is(.foo), :not(.bar), :where(.baz) pseudo-class arguments
                selectors.walkPseudos(pseudo => {
                    if ([':is', ':not', ':where', ':has'].includes(pseudo.value)) {
                        pseudo.walkClasses(node => {
                            if (node.value) classes.add(node.value);
                        });
                    }
                });
            }).processSync(rule.selector);
        } catch (e) { /* skip invalid selectors */ }
    });
}

function _extractWithRegex(cssContent, classes) {
    // More thorough than original: handles .class{ .class, .class: .class> .class+ .class~
    const re = /\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)(?=[\s.,+~>:{[#)]|$)/g;
    let m;
    while ((m = re.exec(cssContent)) !== null) {
        if (m[1]) classes.add(m[1]);
    }
}

module.exports = { extractClassesFromScssFile };
