# What Gets Sent to ChatGPT

## Answer: Only the CHANGES (diff/patch), NOT the whole file!

The action sends **only the changes (patch/diff)** to ChatGPT, not the entire file content.

## How it works:

1. **GitHub API Call**: `repos.compareCommits()` gets the diff between base and head branches
2. **Patch Extraction**: Each file's `patch` property contains only the changed lines
3. **Format**: The patch is in standard Git diff format

## Example of what ChatGPT receives:

```
src/components/Button.tsx
@@ -1,7 +1,8 @@
 import React from 'react';
 
-const Button = ({ onClick, children }) => {
+const Button = ({ onClick, children, disabled = false }) => {
   return (
-    <button onClick={onClick}>
+    <button onClick={onClick} disabled={disabled}>
       {children}
     </button>
   );

src/utils/helper.ts
@@ -10,6 +10,10 @@
   return data.map(item => item.id);
 }
 
+export function validateEmail(email: string): boolean {
+  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
+}
+
 export function formatDate(date: Date): string {
   return date.toISOString().split('T')[0];
 }
```

## Key Points:

- ✅ **Only changed lines** are sent (with some context)
- ✅ **Multiple files** are concatenated into one request
- ✅ **Filename is included** for context
- ❌ **Full file content** is NOT sent
- ❌ **Unchanged parts** are NOT included (except minimal context)

## Advantages:

1. **Token Efficient**: Uses much fewer tokens than sending full files
2. **Focused Review**: AI focuses only on what actually changed
3. **Cost Effective**: Lower API costs
4. **Faster Processing**: Less data to analyze
5. **Better Context**: AI sees exactly what was modified

## Context Provided:

The diff format includes:
- **File path**: So AI knows which file is being modified
- **Line numbers**: Shows where changes occur
- **Context lines**: A few unchanged lines around changes for context
- **Change indicators**: `+` for additions, `-` for deletions
