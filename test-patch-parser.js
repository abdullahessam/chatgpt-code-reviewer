// Simple test script to verify patch parsing logic
// We'll test the core logic without imports for now

const parsePatchForChanges = (patch) => {
  const lines = patch.split('\n');
  const lineHeaderRegExp = /^@@ -\d+,\d+ \+(\d+),(\d+) @@/;
  
  let currentNewLineNumber = 1;
  let firstChangedLine = 1;
  let hasChanges = false;
  const addedLines = [];
  const modifiedLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineHeaderMatch = line.match(lineHeaderRegExp);
    
    if (lineHeaderMatch) {
      currentNewLineNumber = parseInt(lineHeaderMatch[1], 10);
      
      // Parse the content after the header
      for (let j = i + 1; j < lines.length; j++) {
        const patchLine = lines[j];
        
        // Stop if we hit another patch header
        if (patchLine.startsWith('@@')) {
          break;
        }
        
        // Skip file headers
        if (patchLine.startsWith('+++') || patchLine.startsWith('---')) {
          continue;
        }
        
        if (patchLine.startsWith('+')) {
          // Added line
          addedLines.push(currentNewLineNumber);
          if (!hasChanges) {
            firstChangedLine = currentNewLineNumber;
            hasChanges = true;
          }
          currentNewLineNumber++;
        } else if (patchLine.startsWith('-')) {
          // Removed line - check if next line is an addition (modification)
          if (j + 1 < lines.length && lines[j + 1].startsWith('+')) {
            modifiedLines.push(currentNewLineNumber);
            if (!hasChanges) {
              firstChangedLine = currentNewLineNumber;
              hasChanges = true;
            }
          }
          // Don't increment currentNewLineNumber for removed lines
        } else if (patchLine.startsWith(' ') || patchLine === '') {
          // Context line
          currentNewLineNumber++;
        }
      }
      
      break; // Process only the first patch section for now
    }
  }
  
  return {
    firstChangedLine: hasChanges ? firstChangedLine : currentNewLineNumber,
    hasChanges,
    addedLines,
    modifiedLines,
  };
};

const extractFirstChangedLineFromPatch = (patch) => {
  const patchInfo = parsePatchForChanges(patch);
  return patchInfo.firstChangedLine;
};

// Test patch examples
const testPatches = [
  {
    name: "Simple addition",
    patch: `@@ -1,3 +1,4 @@
 console.log('existing line 1');
 console.log('existing line 2');
+console.log('new line added');
 console.log('existing line 3');`
  },
  {
    name: "Modification (deletion + addition)",
    patch: `@@ -10,4 +10,4 @@
 function example() {
-  return 'old value';
+  return 'new value';
 }`
  },
  {
    name: "Multiple additions",
    patch: `@@ -5,2 +5,5 @@
 existing line
+first new line
+second new line
+third new line
 another existing line`
  },
  {
    name: "Mixed changes",
    patch: `@@ -15,6 +15,8 @@
 context line 1
 context line 2
-removed line
+replacement line
 context line 3
+completely new line
 context line 4`
  }
];

console.log('🧪 Testing Patch Parser...\n');

testPatches.forEach((test, index) => {
  console.log(`\n--- Test ${index + 1}: ${test.name} ---`);
  console.log('Patch:');
  console.log(test.patch);
  
  const patchInfo = parsePatchForChanges(test.patch);
  const firstChangedLine = extractFirstChangedLineFromPatch(test.patch);
  
  console.log('\nResults:');
  console.log(`- First changed line: ${firstChangedLine}`);
  console.log(`- Has changes: ${patchInfo.hasChanges}`);
  console.log(`- Added lines: [${patchInfo.addedLines.join(', ')}]`);
  console.log(`- Modified lines: [${patchInfo.modifiedLines.join(', ')}]`);
  console.log('---\n');
});

console.log('✅ All tests completed!');
