# SCSS Usage Analyzer

A CLI tool that statically analyses SCSS and React files to detect unused CSS classes.

It compiles SCSS, parses the resulting CSS, extracts class selectors, and compares them against class usage in React components.

---

## ✨ Features

### Accurate CSS Parsing
- Compiles `.scss` and `.css` files using `sass`
- Parses compiled CSS with `postcss` + `postcss-selector-parser`
- Handles `:is()`, `:not()`, `:where()`, `:has()` pseudo-class arguments
- Handles `[class~="foo"]` attribute selectors
- Falls back to a safe regex parser if optional dependencies are unavailable

### Intelligent React Class Extraction
- String literals: `className="foo bar"`
- Template literals: `` className={`btn-${size}`} ``
- `clsx`, `classNames`, `cx`, `cn` helper calls
- Arrays and object expressions (BEM modifiers, conditional classes)
- CSS Module member expressions: `styles.foo`, `styles['foo-bar']`
- Logical expressions: `condition && 'class'`
- Full `errorRecovery` mode on the Babel parser — survives minor syntax errors

### Dynamic Class Detection
Template literals with interpolations (e.g. `` `btn-${variant}` ``) are detected and
reported separately. Classes whose names are covered by a dynamic pattern are **suppressed
from the unused list** — preventing false positives that were common in v1.

### Ghost Class Report *(new)*
Classes that appear in React code but are **never defined in any SCSS file** are
reported as "ghost" classes. These are likely:
- Typos
- Classes from a third-party library that you may be reinventing
- Leftovers after a rename

### Grouped Output *(new)*
Unused and ghost classes are grouped by source file, making it easy to decide
"I can delete this whole partial" rather than scrolling a flat 360-item list.

### mtime-based Caching *(new)*
On repeat runs, unchanged files are skipped entirely. The cache is stored at
`.scss-analyzer-cache.json` in the target directory. Pass `--no-cache` to force
a full re-scan.

### Watch Mode *(new)*
`--watch` re-runs the analysis automatically whenever any `.scss`, `.css`, `.js`,
`.jsx`, `.ts`, or `.tsx` file changes.

### Usage Threshold *(new)*
`--threshold <n>` also flags classes used **fewer than n times** in React. Useful for
identifying classes you've kept "just in case" but almost never reach.

### Supported file types
- Scans: `.js`, `.jsx`, `.ts`, `.tsx`, `.scss`, `.css`
- Uses `fast-glob` when available for performance
- Falls back to safe recursive file scanning
- Ignores: `node_modules`, `build`, `dist`, `.git`, `.cache`, `coverage`, `__mocks__`

---

## Installation

1. Create a directory and initialise it:
```bash
mkdir scss-analyzer
cd scss-analyzer
npm init -y
```

2. Install required dependencies:
```bash
npm install sass @babel/parser @babel/traverse
```

3. Install optional dependencies (improve accuracy and speed):
```bash
npm install postcss postcss-selector-parser fast-glob
```

4. Copy the following files into your directory:
```
analyze-scss.js
extractors/
  scss.js
  react.js
utils/
  files.js
  cache.js
reporters/
  index.js
```

---

## Usage

```bash
# Basic
node analyze-scss.js /path/to/your/project

# JSON output (for CI or piping to jq)
node analyze-scss.js --json /path/to/your/project

# Flag classes used fewer than 3 times
node analyze-scss.js --threshold 3 /path/to/your/project

# Watch mode
node analyze-scss.js --watch /path/to/your/project

# Skip cache
node analyze-scss.js --no-cache /path/to/your/project
```

---

## Example Output

```
────────────────────────────────────────────────────────────
  SCSS Usage Analysis Report
────────────────────────────────────────────────────────────
  Directory : /users/bigco/project/frontend
  React files scanned  : 992
  SCSS files scanned   : 54
  Total SCSS classes   : 1666
  Used in React        : 1714
  Unused classes       : 312
  Ghost classes (used but never defined in SCSS): 48
  Dynamic class patterns detected: 6
────────────────────────────────────────────────────────────

⚠  Unused classes:
  web/src/sass/base/_animations.scss  (1 unused)
    · c-icon-animated--sharing

  web/src/sass/base/_utilities.scss  (11 unused)
    · u-clamp
    · u-clamp_3
    · u-clamp_4
    · u-fixed-bottom
    · u-float-right
    ...

👻  Ghost classes (used in React, never defined in SCSS):
  src/components/Button/Button.tsx  (2 ghost)
    · btn-primry          ← likely a typo of btn-primary
    · is-actve            ← likely a typo of is-active

⚡  Dynamic class patterns (may suppress false positives):
    · `btn-${…}`
    · `u-margin-${…}`
    · `col-${…}-${…}`

────────────────────────────────────────────────────────────
```

---

## Caveats

Static analysis cannot resolve all runtime class names. Classes built from external
configuration objects, Redux state, or API responses will not be detected. Always
review the unused list before deleting anything.
