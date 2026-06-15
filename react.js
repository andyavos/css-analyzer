'use strict';
/**
 * extractors/react.js
 * Parses React/TS files and extracts used class names.
 *
 * Handles:
 *  - className="foo bar"
 *  - className={`foo ${cond ? 'bar' : 'baz'}`}
 *  - clsx / classNames / cx calls
 *  - CSS Module member expressions (styles.foo, styles['foo'])
 *  - Detects DYNAMIC classes (e.g. `btn-${variant}`) and reports them separately
 *    so they're not falsely flagged as "unused"
 */

const parser = require('@babel/parser');

let traverse = null;
try {
    const mod = require('@babel/traverse');
    traverse = mod.default || mod; // guard against ESM/CJS interop issues
} catch (e) {
    console.error('Fatal: @babel/traverse is required. Run: npm install @babel/traverse');
    process.exit(1);
}

const CLSX_NAMES = new Set(['clsx', 'classNames', 'cx', 'cn']);

/**
 * Extract class information from a React file.
 * Returns:
 *   staticClasses  – Set<string>  classes we can statically resolve
 *   dynamicPatterns – Set<string>  template literal skeletons like "btn-${...}"
 *                     These signal "any class matching this prefix may be used"
 */
function extractClassesFromReactFile(filePath) {
    const staticClasses = new Set();
    const dynamicPatterns = new Set();

    let content;
    try {
        content = require('fs').readFileSync(filePath, 'utf8');
    } catch (e) {
        console.warn(`Warning: couldn't read ${filePath}: ${e.message}`);
        return { staticClasses, dynamicPatterns };
    }

    let ast;
    try {
        ast = parser.parse(content, {
            sourceType: 'module',
            plugins: [
                'jsx',
                'typescript',
                'classProperties',
                'optionalChaining',
                'nullishCoalescingOperator',
                'decorators-legacy',
            ],
            errorRecovery: true, // keep going on minor syntax errors
        });
    } catch (err) {
        console.warn(`Warning: parse error in ${filePath}: ${err.message}`);
        return { staticClasses, dynamicPatterns };
    }

    traverse(ast, {
        JSXAttribute(nodePath) {
            try {
                const attrName = nodePath.node.name && nodePath.node.name.name;
                if (attrName !== 'className' && attrName !== 'class') return;
                const val = nodePath.node.value;
                if (!val) return;
                if (val.type === 'StringLiteral') {
                    _splitClasses(val.value, staticClasses);
                } else if (val.type === 'JSXExpressionContainer') {
                    _collectFromExpr(val.expression, staticClasses, dynamicPatterns);
                }
            } catch (e) { /* ignore */ }
        },

        CallExpression(nodePath) {
            try {
                const name = _calleeName(nodePath.node.callee);
                if (CLSX_NAMES.has(name)) {
                    nodePath.node.arguments.forEach(arg =>
                        _collectFromExpr(arg, staticClasses, dynamicPatterns)
                    );
                }
            } catch (e) { /* ignore */ }
        },
    });

    return { staticClasses, dynamicPatterns };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _splitClasses(str, out) {
    str.split(/\s+/).forEach(c => c && out.add(c));
}

function _calleeName(callee) {
    if (!callee) return null;
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression' && callee.property) {
        return callee.property.type === 'Identifier'
            ? callee.property.name
            : String(callee.property.value ?? '');
    }
    return null;
}

function _collectFromExpr(expr, statics, dynamics) {
    if (!expr) return;

    switch (expr.type) {
        case 'StringLiteral':
        case 'Literal':
            _splitClasses(String(expr.value ?? ''), statics);
            break;

        case 'TemplateLiteral': {
            // Build a skeleton string from quasis to detect dynamic patterns
            // e.g. `btn-${size}` → static part "btn-" → dynamic pattern "btn-*"
            const parts = expr.quasis.map(q => q.value.cooked ?? q.value.raw);
            const hasDynamic = expr.expressions.length > 0;

            if (!hasDynamic) {
                // Pure template string with no interpolations
                _splitClasses(parts.join(''), statics);
            } else {
                // Extract any purely static tokens (words between interpolations)
                parts.forEach(part => {
                    part.split(/\s+/).forEach(tok => {
                        if (tok) {
                            // If the token contains no partial word (i.e. it's a whole class), count it
                            statics.add(tok);
                        }
                    });
                });
                // Record the dynamic skeleton so we can suppress false "unused" warnings
                const skeleton = parts.join('${…}').trim();
                if (skeleton) dynamics.add(skeleton);
            }
            break;
        }

        case 'BinaryExpression':
            _collectFromExpr(expr.left, statics, dynamics);
            _collectFromExpr(expr.right, statics, dynamics);
            break;

        case 'ConditionalExpression':
            _collectFromExpr(expr.consequent, statics, dynamics);
            _collectFromExpr(expr.alternate, statics, dynamics);
            break;

        case 'LogicalExpression':
            _collectFromExpr(expr.left, statics, dynamics);
            _collectFromExpr(expr.right, statics, dynamics);
            break;

        case 'ArrayExpression':
            (expr.elements || []).forEach(el => _collectFromExpr(el, statics, dynamics));
            break;

        case 'ObjectExpression':
            (expr.properties || []).forEach(prop => {
                if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') return;
                const key = prop.key;
                if (key.type === 'Identifier') statics.add(key.name);
                else if (key.type === 'StringLiteral' || key.type === 'Literal') _splitClasses(String(key.value ?? ''), statics);
                // Also walk the value: e.g. { [styles.foo]: condition }
                _collectFromExpr(prop.value, statics, dynamics);
            });
            break;

        case 'CallExpression': {
            const name = _calleeName(expr.callee);
            if (CLSX_NAMES.has(name)) {
                (expr.arguments || []).forEach(a => _collectFromExpr(a, statics, dynamics));
            } else {
                // Generic call — try args anyway (handles custom wrappers)
                (expr.arguments || []).forEach(a => _collectFromExpr(a, statics, dynamics));
            }
            break;
        }

        case 'MemberExpression':
            // styles.foo  →  add 'foo'
            if (!expr.computed && expr.property?.type === 'Identifier') {
                statics.add(expr.property.name);
            }
            // styles['foo-bar']  →  add 'foo-bar'
            if (expr.computed && (expr.property?.type === 'StringLiteral' || expr.property?.type === 'Literal')) {
                _splitClasses(String(expr.property.value ?? ''), statics);
            }
            // styles[`foo-${x}`]  →  dynamic
            if (expr.computed && expr.property?.type === 'TemplateLiteral') {
                _collectFromExpr(expr.property, statics, dynamics);
            }
            break;

        default:
            // Recurse into any sub-expressions we recognise
            if (expr.left) _collectFromExpr(expr.left, statics, dynamics);
            if (expr.right) _collectFromExpr(expr.right, statics, dynamics);
            if (expr.consequent) _collectFromExpr(expr.consequent, statics, dynamics);
            if (expr.alternate) _collectFromExpr(expr.alternate, statics, dynamics);
            if (Array.isArray(expr.arguments)) expr.arguments.forEach(a => _collectFromExpr(a, statics, dynamics));
            break;
    }
}

module.exports = { extractClassesFromReactFile };
