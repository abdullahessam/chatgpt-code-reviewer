interface PatchInfo {
  firstChangedLine: number;
  hasChanges: boolean;
  addedLines: number[];
  modifiedLines: number[];
}

const parsePatchForChanges = (patch: string): PatchInfo => {
  const lines = patch.split('\n');
  const lineHeaderRegExp = /^@@ -\d+,\d+ \+(\d+),(\d+) @@/;
  
  let currentNewLineNumber = 1;
  let firstChangedLine = 1;
  let hasChanges = false;
  const addedLines: number[] = [];
  const modifiedLines: number[] = [];
  
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

export default parsePatchForChanges;
export type { PatchInfo };
