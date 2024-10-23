# CSS Analyzer
Find unused classes and deprecations in a React project

1. Create a new directory for the project and initialize it:
```
mkdir scss-analyzer
cd scss-analyzer
npm init -y
```

2. Install the required dependencies:

```
npm install sass @babel/parser @babel/traverse
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
