// Test the line detection logic with a sample patch
const getValidCommentLines = (patch) => {
  const lines = patch.split('\n');
  const lineHeaderRegExp = /^@@ -\d+,\d+ \+(\d+),(\d+) @@/;
  const validLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineHeaderMatch = line.match(lineHeaderRegExp);
    
    if (lineHeaderMatch) {
      let currentNewLineNumber = parseInt(lineHeaderMatch[1], 10);
      
      console.log(`📍 Patch starts at line ${currentNewLineNumber}`);
      
      // Parse the content after the header
      for (let j = i + 1; j < lines.length; j++) {
        const patchLine = lines[j];
        
        // Stop if we hit another patch header or end of patch
        if (patchLine.startsWith('@@')) {
          break;
        }
        
        // Skip file headers
        if (patchLine.startsWith('+++') || patchLine.startsWith('---')) {
          continue;
        }
        
        console.log(`   Line ${currentNewLineNumber}: "${patchLine}" (${patchLine.charAt(0)})`);
        
        if (patchLine.startsWith('+')) {
          // Added line - these are usually the best for comments
          validLines.push({
            lineNumber: currentNewLineNumber,
            type: 'added',
            content: patchLine.substring(1)
          });
          currentNewLineNumber++;
        } else if (patchLine.startsWith('-')) {
          // Removed line - check if next line is an addition (modification)
          if (j + 1 < lines.length && lines[j + 1].startsWith('+')) {
            validLines.push({
              lineNumber: currentNewLineNumber,
              type: 'modified',
              content: patchLine.substring(1)
            });
          }
          // Don't increment line number for removed lines
        } else if (patchLine.startsWith(' ')) {
          // Context line - these can also be used for comments
          validLines.push({
            lineNumber: currentNewLineNumber,
            type: 'context',
            content: patchLine.substring(1)
          });
          currentNewLineNumber++;
        } else if (patchLine.trim() === '') {
          // Empty line
          currentNewLineNumber++;
        }
      }
      
      break; // Process only the first patch section for now
    }
  }
  
  return validLines;
};

// Test with a sample patch (similar to what might be in your screenshot)
const samplePatch = `@@ -35,5 +35,5 @@
 
 Route::get('/delete-account', [PageController::class, 'deleteAccount'])->name('delete-account');
-Route::post('/telr/callback/success', [TelrController::class, 'handleSuccessCallback'])->name('telr.callback.success');
-Route::post('/telr/callback/failure', [TelrController::class, 'handleFailureCallback'])->name('telr.callback.failure');
+Route::post('/telr/callback/success', [TelrController::class, 'handleSuccessCallback'])->name('telr.callback.success');
+Route::post('/telr/callback/failure', [TelrController::class, 'handleFailureCallback'])->name('telr.callback.failure');`;

console.log('🧪 Testing patch parsing...\n');
console.log('Sample patch:');
console.log(samplePatch);
console.log('\n📊 Analysis:');

const validLines = getValidCommentLines(samplePatch);

console.log('\n✅ Valid comment lines found:');
validLines.forEach(line => {
  console.log(`   Line ${line.lineNumber} (${line.type}): ${line.content}`);
});

console.log(`\n🎯 Recommended target lines:`);
const addedLines = validLines.filter(l => l.type === 'added');
const modifiedLines = validLines.filter(l => l.type === 'modified');

if (addedLines.length > 0) {
  console.log(`   Primary: Line ${addedLines[0].lineNumber} (added)`);
}
if (modifiedLines.length > 0) {
  console.log(`   Secondary: Line ${modifiedLines[0].lineNumber} (modified)`);
}
if (validLines.length > 0) {
  console.log(`   Fallback: Line ${validLines[0].lineNumber} (${validLines[0].type})`);
}
