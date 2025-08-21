# How Reviews are Sent to ChatGPT

## Answer: MULTIPLE files in BATCHES, not one by one!

The action sends **multiple files together in batches** to ChatGPT, not individual files one by one.

## How the Batching Works:

### 1. **File Grouping**
- Files are grouped into batches based on token limits
- Each batch can contain multiple files up to `MAX_TOKENS / 2` (e.g., 2048 tokens)
- Files are combined into a single request per batch

### 2. **Batch Processing**
```
Batch 1: [file1.js, file2.css, file3.html] → Single OpenAI Request
Batch 2: [file4.php, file5.ts]            → Single OpenAI Request  
Batch 3: [file6.py]                       → Single OpenAI Request
```

### 3. **Request Format**
Each batch sends ALL files in one request like this:

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

src/styles/main.css
@@ -10,6 +10,10 @@
 .container {
   width: 100%;
 }
+
+.button:disabled {
+  opacity: 0.5;
+}

src/utils/helper.js
@@ -5,3 +5,7 @@
 export function formatDate(date) {
   return date.toLocaleDateString();
 }
+
+export function validateInput(input) {
+  return input && input.trim().length > 0;
+}
```

## Advantages of Batch Processing:

### ✅ **Benefits:**
1. **Context Awareness**: AI can see relationships between files
2. **Cost Efficient**: Fewer API calls = lower costs
3. **Consistent Reviews**: Same context for related changes
4. **Better Suggestions**: AI understands cross-file dependencies

### 📊 **Example Scenario:**
- **20 files changed in PR**
- **Token limit: 2048 per batch**
- **Result: 3-4 batches = 3-4 OpenAI requests**

## Timing Between Batches:

- **First batch**: Processed immediately
- **Subsequent batches**: Delayed by 20 seconds each (OPENAI_TIMEOUT)
- **Reason**: Avoid rate limiting and spread API usage

## Code Evidence:

```typescript
// Files are divided into batches by token count
const listOfFilesByTokenRange = divideFilesByTokenRange(
  MAX_TOKENS / 2,
  patchesList,
);

// Each batch gets one API call
await this.createReviewComments(listOfFilesByTokenRange[0]);

// Additional batches are processed with delays
if (listOfFilesByTokenRange.length > 1) {
  // Process remaining batches with 20-second intervals
}
```

## Summary:

- ❌ **NOT** one file per request
- ✅ **Multiple files per batch**
- ✅ **One API request per batch**
- ✅ **Batches processed sequentially with delays**
- ✅ **AI sees multiple files together for better context**
