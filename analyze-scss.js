const fs = require('fs');
const path = require('path');
const sass = require('sass');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Function to validate directory exists and has required files
function validateDirectory(dir) {
    if (!fs.existsSync(dir)) {
        throw new Error(`Directory does not exist: ${dir}`);
    }

    const stats = fs.statSync(dir);
    if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${dir}`);
    }

    // Check if we can find any React or SCSS files
    const hasReactFiles = getFiles(dir, ['.jsx', '.tsx']).length > 0;
    const hasScssFiles = getFiles(dir, ['.scss']).length > 0;

    if (!hasReactFiles) {
        throw new Error('No React files (.jsx or .tsx) found in the directory');
    }
    if (!hasScssFiles) {
        throw new Error('No SCSS files (.scss) found in the directory');
    }
}

// Function to get all files with specific extensions
function getFiles(dir, extensions, ignoreDirs = ['node_modules', 'build', 'dist']) {
    let results = [];
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            if (!ignoreDirs.includes(file)) {
                results = results.concat(getFiles(filePath, extensions, ignoreDirs));
            }
        } else if (extensions.includes(path.extname(file))) {
            results.push(filePath);
        }
    }
    
    return results;
}

// Function to extract class names from SCSS files
function extractScssClasses(scssContent, filePath) {
    const classes = new Set();
    
    try {
        // Compile SCSS to CSS
        const result = sass.compileString(scssContent, {
            loadPaths: [path.dirname(filePath)] // Allow imports from the same directory
        });
        const cssContent = result.css;
        
        // Enhanced regex to handle more SCSS patterns
        const classRegex = /\.([a-zA-Z0-9_-]+)[^{]*\{|@include\s+([a-zA-Z0-9_-]+)/g;
        let match;
        
        while ((match = classRegex.exec(cssContent)) !== null) {
            if (match[1]) classes.add(match[1]);
            if (match[2]) classes.add(match[2]); // Include mixin names
        }
    } catch (error) {
        console.warn(`Warning: Error processing SCSS file ${filePath}:`, error.message);
    }
    
    return classes;
}

// Function to extract class names from React files
function extractReactClasses(reactContent, filePath) {
    const classes = new Set();
    
    try {
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
                        path.node.value.value.split(' ').forEach(cls => {
                            if (cls.trim()) classes.add(cls.trim());
                        });
                    } else if (path.node.value.type === 'TemplateLiteral') {
                        // Handle template literals
                        path.node.value.quasis.forEach(quasi => {
                            quasi.value.raw.split(' ').forEach(cls => {
                                if (cls.trim()) classes.add(cls.trim());
                            });
                        });
                    }
                }
            },
            // Also check for clsx/classnames usage
            CallExpression(path) {
                if (path.node.callee.name === 'clsx' || path.node.callee.name === 'classNames') {
                    path.node.arguments.forEach(arg => {
                        if (arg.type === 'StringLiteral') {
                            arg.value.split(' ').forEach(cls => {
                                if (cls.trim()) classes.add(cls.trim());
                            });
                        }
                    });
                }
            }
        });
    } catch (error) {
        console.warn(`Warning: Error processing React file ${filePath}:`, error.message);
    }
    
    return classes;
}

// Main function to analyze SCSS usage
function analyzeScssUsage(directory) {
    // Resolve and validate the directory path
    const resolvedDir = path.resolve(directory);
    validateDirectory(resolvedDir);
    
    // Get all React and SCSS files
    const reactFiles = getFiles(resolvedDir, ['.jsx', '.tsx']);
    const scssFiles = getFiles(resolvedDir, ['.scss']);
    
    // Extract all SCSS classes
    const allScssClasses = new Map(); // Map to store classes and their source files
    scssFiles.forEach(file => {
        const content = fs.readFileSync(file, 'utf8');
        const classes = extractScssClasses(content, file);
        classes.forEach(cls => {
            if (!allScssClasses.has(cls)) {
                allScssClasses.set(cls, file);
            }
        });
    });
    
    // Extract all used classes from React files
    const usedClasses = new Map(); // Map to store classes and their usage locations
    reactFiles.forEach(file => {
        const content = fs.readFileSync(file, 'utf8');
        const classes = extractReactClasses(content, file);
        classes.forEach(cls => {
            if (!usedClasses.has(cls)) {
                usedClasses.set(cls, file);
            }
        });
    });
    
    // Find unused classes
    const unusedClasses = new Map();
    allScssClasses.forEach((file, cls) => {
        if (!usedClasses.has(cls)) {
            unusedClasses.set(cls, file);
        }
    });
    
    // Generate report
    return {
        totalScssClasses: allScssClasses.size,
        totalUsedClasses: usedClasses.size,
        unusedClasses: Array.from(unusedClasses.entries()),
        unusedClassesCount: unusedClasses.size,
        scssFiles: scssFiles.length,
        reactFiles: reactFiles.length,
        directory: resolvedDir
    };
}

// Usage example
try {
    const directory = process.argv[2] || '.';
    const report = analyzeScssUsage(directory);
    
    console.log('\nSCSS Usage Analysis Report');
    console.log('------------------------');
    console.log(`Analyzing directory: ${report.directory}`);
    console.log(`Total SCSS classes found: ${report.totalScssClasses}`);
    console.log(`Total classes used in React: ${report.totalUsedClasses}`);
    console.log(`Number of unused classes: ${report.unusedClassesCount}`);
    console.log(`\nFiles analyzed:`);
    console.log(`- React files: ${report.reactFiles}`);
    console.log(`- SCSS files: ${report.scssFiles}`);
    
    if (report.unusedClasses.length > 0) {
        console.log('\nUnused classes and their locations:');
        report.unusedClasses.forEach(([cls, file]) => {
            console.log(`- ${cls} (defined in ${path.relative(report.directory, file)})`);
        });
    }
} catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
}
