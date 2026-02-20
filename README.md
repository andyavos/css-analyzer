# SCSS Usage Analyzer
A CLI tool that statically analyzes SCSS and React files to detect unused CSS classes.

It compiles SCSS, parses the resulting CSS, extracts class selectors, and compares them against class usage in React components.

## ✨ Features

### Accurate CSS Parsing

Compiles .scss files using sass

Parses compiled CSS with postcss

Extracts selectors using postcss-selector-parser

Falls back to safe regex parsing if optional dependencies are unavailable

This avoids fragile selector regex matching and improves reliability.

### Intelligent React Class Extraction

Supports common React class usage patterns:

- String literals
- Template literals
- clsx, classNames, cx
- Arrays
- Object expressions (BEM modifiers, conditional classes)
- CSS module references

### Supported file types

Scans: .js, .jsx, .ts, .tsx, .scss

Uses fast-glob when available for performance

Falls back to safe recursive file scanning

Ignores common directories (node_modules, build, dist, .git)


1. Create a new directory for the project and initialize it:
```
mkdir scss-analyzer
cd scss-analyzer
npm init -y
```

2. Install the required dependencies:

```
npm install sass @babel/parser @babel/traverse postcss postcss-selector-parser fast-glob
```

3. Save script and run
```
node analyze-scss.js /path/to/your/project
```

## Example output

```

   ╷
16 │ $orange-dark: darken(#f89238, 7%);
   │               ^^^^^^^^^^^^^^^^^^^
   ╵
    tokens/_color.scss 16:15  @import
    - 1:9                     root stylesheet

Deprecation Warning: darken() is deprecated. Suggestions:

color.scale($color, $lightness: -11.7434210526%)
color.adjust($color, $lightness: -7%)

More info: https://sass-lang.com/d/color-functions

```
```
SCSS Usage Analysis Report
------------------------
Analyzing directory: /users/bigco/project/frontend
Total SCSS classes found: 533
Total classes used in React: 446
Number of unused classes: 226

Files analyzed:
- React files: 243
- SCSS files: 57

Unused classes and their locations:
- c-icon-animated--sharing (defined in web/src/sass/base/_animations.scss)
- u-margin-right (defined in web/src/sass/base/_utilities.scss)
- u-margin-bottom (defined in web/src/sass/base/_utilities.scss)
- u-margin-bottom--16 (defined in web/src/sass/base/_utilities.scss)
- u-padding--16 (defined in web/src/sass/base/_utilities.scss)
- u-fixed-bottom (defined in web/src/sass/base/_utilities.scss)
- u-width_200 (defined in web/src/sass/base/_utilities.scss)
- u-float-right (defined in web/src/sass/base/_utilities.scss)
- u-min-width-148 (defined in web/src/sass/base/_utilities.scss)
- u-clamp (defined in web/src/sass/base/_utilities.scss)
- u-clamp_3 (defined in web/src/sass/base/_utilities.scss)
- u-clamp_4 (defined in web/src/sass/base/_utilities.scss)
```
