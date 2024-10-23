const fs = require('fs');
const path = require('path');
const sass = require('sass');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Function to get all files with specific extensions

function getFiles(dir, extensions) {
    let results = [];
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            results = results.concat(getFiles(filePath, extensions));
        } else if (extensions.includes(path.extname(file))) {
            results.push(filePath);
        }
    }
    
    return results;
}

// Function to extract class names from SCSS files

function extractScssClasses(scssContent) {
    const classes = new Set();
    
    // Compile SCSS to CSS
    const result = sass.compileString(scssContent);
    const cssContent = result.css;
    
    // Simple regex to extract class names from CSS
    const classRegex = /\.([a-zA-Z0-9_-]+)/g;
    let match;
    
    while ((match = classRegex.exec(cssContent)) !== null) {
        classes.add(match[1]);
    }
    
    return classes;
}

// Function to extract class names from React files
function extractReactClasses(reactContent) {
    const classes = new Set();
    
    // Parse the React file
    const ast = parser.parse(reactContent, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript']
    });
    
    // Traverse the AST to find className usage
    traverse(ast, {
        JSXAttribute(path) {
            if (path.node.name.name === 'className') {
                if (path.node.value.type === 'StringLiteral') {
                    // Handle direct string literals
                    path.node.value.value.split(' ').forEach(cls => classes.add(cls));
                } else if (path.node.value.type === 'TemplateLiteral') {
                    // Handle template literals
                    path.node.value.quasis.forEach(quasi => {
                        quasi.value.raw.split(' ').forEach(cls => {
                            if (cls) classes.add(cls);
                        });
                    });
                }
            }
        }
    });
    
    return classes;
}

// Main function to analyze SCSS usage
function analyzeScssUsage(directory) {
    // Get all React and SCSS files
    const reactFiles = getFiles(directory, ['.jsx', '.tsx']);
    const scssFiles = getFiles(directory, ['.scss']);
    
    // Extract all SCSS classes
    const allScssClasses = new Set();
    scssFiles.forEach(file => {
        const content = fs.readFileSync(file, 'utf8');
        const classes = extractScssClasses(content);
        classes.forEach(cls => allScssClasses.add(cls));
    });
    
    // Extract all used classes from React files
    const usedClasses = new Set();
    reactFiles.forEach(file => {
        const content = fs.readFileSync(file, 'utf8');
        const classes = extractReactClasses(content);
        classes.forEach(cls => usedClasses.add(cls));
    });
    
    // Find unused classes
    const unusedClasses = new Set(
        [...allScssClasses].filter(cls => !usedClasses.has(cls))
    );
    
    // Generate report
    return {
        totalScssClasses: allScssClasses.size,
        totalUsedClasses: usedClasses.size,
        unusedClasses: [...unusedClasses],
        unusedClassesCount: unusedClasses.size,
        scssFiles: scssFiles.length,
        reactFiles: reactFiles.length
    };
}

// Usage example

try {
    const directory = process.argv[2] || '.';
    const report = analyzeScssUsage(directory);
    
    console.log('\nSCSS Usage Analysis Report');
    console.log('------------------------');
    console.log(`Total SCSS classes found: ${report.totalScssClasses}`);
    console.log(`Total classes used in React: ${report.totalUsedClasses}`);
    console.log(`Number of unused classes: ${report.unusedClassesCount}`);
    console.log(`\nFiles analyzed:`);
    console.log(`- React files: ${report.reactFiles}`);
    console.log(`- SCSS files: ${report.scssFiles}`);
    
    if (report.unusedClasses.length > 0) {
        console.log('\nUnused classes:');
        report.unusedClasses.forEach(cls => console.log(`- ${cls}`));
    }
} catch (error) {
    console.error('Error:', error.message);
}
