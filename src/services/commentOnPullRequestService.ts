import { getInput } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { encode } from 'gpt-3-encoder';

import errorsConfig, { ErrorMessage } from '../config/errorsConfig';
import { FilenameWithPatch, Octokit, PullRequestInfo } from './types';
import concatenatePatchesToString from './utils/concatenatePatchesToString';
import divideFilesByTokenRange from './utils/divideFilesByTokenRange';
import extractFirstChangedLineFromPatch from './utils/extractFirstChangedLineFromPatch';
import getOpenAiSuggestions from './utils/getOpenAiSuggestions';
import parsePatchForChanges from './utils/patchParser';
import parseOpenAISuggestions from './utils/parseOpenAISuggestions';

const MAX_TOKENS = parseInt(getInput('max_tokens'), 10) || 4096;
const OPENAI_TIMEOUT = 20000;
const SHOW_SKIPPED_FILES_COMMENT = process.env.SHOW_SKIPPED_FILES_COMMENT !== 'false'; // Default to true

class CommentOnPullRequestService {
  private readonly octokitApi: Octokit;
  private readonly pullRequest: PullRequestInfo;

  constructor() {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error(errorsConfig[ErrorMessage.MISSING_GITHUB_TOKEN]);
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new Error(errorsConfig[ErrorMessage.MISSING_OPENAI_TOKEN]);
    }

    if (!context.payload.pull_request) {
      throw new Error(errorsConfig[ErrorMessage.NO_PULLREQUEST_IN_CONTEXT]);
    }

    this.octokitApi = getOctokit(process.env.GITHUB_TOKEN);

    this.pullRequest = {
      owner: context.repo.owner,
      repo: context.repo.repo,
      pullHeadRef: context.payload?.pull_request.head.ref,
      pullBaseRef: context.payload?.pull_request.base.ref,
      pullNumber: context.payload?.pull_request.number,
    };
  }

  private async getBranchDiff() {
    const { owner, repo, pullBaseRef, pullHeadRef } = this.pullRequest;

    const { data: branchDiff } =
      await this.octokitApi.rest.repos.compareCommits({
        owner,
        repo,
        base: pullBaseRef,
        head: pullHeadRef,
      });

    return branchDiff;
  }

  private async getLastCommit() {
    const { owner, repo, pullNumber } = this.pullRequest;

    const { data: commitsList } = await this.octokitApi.rest.pulls.listCommits({
      owner,
      repo,
      per_page: 50,
      pull_number: pullNumber,
    });

    return commitsList[commitsList.length - 1].sha;
  }

  private async createReviewComments(files: FilenameWithPatch[]) {
    // 📊 Log detailed information about files being processed
    console.log('🔍 ===== REVIEW BATCH PROCESSING =====');
    console.log(`📅 Processing started at: ${new Date().toISOString()}`);
    console.log(`📁 Number of files in this batch: ${files.length}`);
    
    files.forEach((file, index) => {
      console.log(`  ${index + 1}. 📄 File: ${file.filename}`);
      console.log(`     🔢 Token count: ${file.tokensUsed}`);
      console.log(`     📏 Patch length: ${file.patch.length} characters`);
    });

    const totalTokens = files.reduce((sum, file) => sum + file.tokensUsed, 0);
    console.log(`🔢 Total tokens in batch: ${totalTokens}`);
    
    const concatenatedPatch = concatenatePatchesToString(files);
    console.log(`📦 Concatenated patch length: ${concatenatedPatch.length} characters`);
    console.log('🚀 Sending to OpenAI...');

    const suggestionsListText = await getOpenAiSuggestions(concatenatedPatch);
    
    console.log('🎯 ===== PARSING AI SUGGESTIONS =====');
    const suggestionsByFile = parseOpenAISuggestions(suggestionsListText);
    console.log(`📋 Parsed ${suggestionsByFile.length} file suggestions from AI response`);
    
    suggestionsByFile.forEach((suggestion, index) => {
      console.log(`  ${index + 1}. 📄 Suggestion for: ${suggestion.filename}`);
      console.log(`     💬 Comment: ${suggestion.suggestionText.substring(0, 100)}...`);
    });

    const { owner, repo, pullNumber } = this.pullRequest;
    const lastCommitId = await this.getLastCommit();

    for (const file of files) {
      const suggestionForFile = suggestionsByFile.find(
        (suggestion) => suggestion.filename === file.filename,
      );

      if (suggestionForFile) {
        try {
          console.log(`🎯 ===== PROCESSING SUGGESTION FOR ${file.filename} =====`);
          console.log(`💬 Suggestion text: ${suggestionForFile.suggestionText.substring(0, 200)}...`);
          
          const consoleTimeLabel = `Comment was created successfully for file: ${file.filename}`;
          console.time(consoleTimeLabel);

          // Try different strategies to place the comment on the right line
          const success = await this.tryCreateLineComment(
            file,
            suggestionForFile,
            { owner, repo, pullNumber, lastCommitId }
          );

          if (!success) {
            console.error(`❌ All comment strategies failed for ${file.filename}`);
          } else {
            console.log(`✅ Successfully processed ${file.filename}`);
          }

          console.timeEnd(consoleTimeLabel);
        } catch (error) {
          console.error(
            `💥 FATAL ERROR while trying to add a comment to ${file.filename}:`,
            error,
          );
          
          // Log additional context for debugging
          console.error(`📋 File details:`, {
            filename: file.filename,
            patchLength: file.patch?.length,
            tokensUsed: file.tokensUsed
          });
          
          console.error(`📋 Suggestion details:`, {
            filename: suggestionForFile.filename,
            suggestionLength: suggestionForFile.suggestionText?.length
          });
          
          // Don't throw here, continue with other files
        }
      } else {
        console.warn(`⚠️ No AI suggestion found for file: ${file.filename}`);
      }
    }
  }

  private async tryCreateLineComment(
    file: FilenameWithPatch,
    suggestion: any,
    context: { owner: string; repo: string; pullNumber: number; lastCommitId: string }
  ): Promise<boolean> {
    const { owner, repo, pullNumber, lastCommitId } = context;
    
    console.log(`🎯 ===== ATTEMPTING TO COMMENT ON ${file.filename} =====`);
    
    // Parse the patch to get line information
    const validLines = this.getValidCommentLines(file.patch);
    
    if (validLines.length === 0) {
      console.warn(`❌ No valid comment lines found for ${file.filename}`);
      // Try to create a general PR comment as fallback
      return await this.createGeneralPRComment(file, suggestion, context);
    }
    
    console.log(`📍 Valid comment lines for ${file.filename}:`, validLines.map(l => `${l.lineNumber}(${l.type})`).join(', '));
    
    // Strategy 1: Try the first added line
    const addedLines = validLines.filter(l => l.type === 'added');
    for (const lineInfo of addedLines) {
      const success = await this.attemptLineComment(file, suggestion, lineInfo, context, 'added line');
      if (success) return true;
    }
    
    // Strategy 2: Try the first modified line (if no added lines worked)
    const modifiedLines = validLines.filter(l => l.type === 'modified');
    for (const lineInfo of modifiedLines) {
      const success = await this.attemptLineComment(file, suggestion, lineInfo, context, 'modified line');
      if (success) return true;
    }
    
    // Strategy 3: Try any valid line from the patch
    const contextLines = validLines.filter(l => l.type === 'context');
    for (const lineInfo of contextLines) {
      const success = await this.attemptLineComment(file, suggestion, lineInfo, context, 'context line');
      if (success) return true;
    }
    
    // Strategy 4: If all line-specific comments fail, create a general PR comment
    console.warn(`⚠️ All line comment strategies failed for ${file.filename}, creating general PR comment`);
    return await this.createGeneralPRComment(file, suggestion, context);
  }

  private async attemptLineComment(
    file: FilenameWithPatch,
    suggestion: any,
    lineInfo: {lineNumber: number, type: string},
    context: { owner: string; repo: string; pullNumber: number; lastCommitId: string },
    strategy: string
  ): Promise<boolean> {
    const { owner, repo, pullNumber, lastCommitId } = context;
    
    try {
      console.log(`🎯 Trying to comment on ${strategy} ${lineInfo.lineNumber} in ${file.filename}`);
      
      await this.octokitApi.rest.pulls.createReviewComment({
        owner,
        repo,
        pull_number: pullNumber,
        line: lineInfo.lineNumber,
        path: file.filename,
        body: `[ChatGPTReviewer]\n${suggestion.suggestionText}`,
        commit_id: lastCommitId,
      });
      
      console.log(`✅ Successfully commented on ${strategy} ${lineInfo.lineNumber}`);
      return true;
    } catch (error: any) {
      console.warn(`❌ Failed to comment on ${strategy} ${lineInfo.lineNumber}: ${error.message}`);
      
      // Log additional error details for debugging
      if (error.response?.data) {
        console.warn(`📋 GitHub API Error Details:`, JSON.stringify(error.response.data, null, 2));
      }
      
      return false;
    }
  }

  private async createGeneralPRComment(
    file: FilenameWithPatch,
    suggestion: any,
    context: { owner: string; repo: string; pullNumber: number; lastCommitId: string }
  ): Promise<boolean> {
    const { owner, repo, pullNumber } = context;
    
    try {
      console.log(`📝 Creating general PR comment for ${file.filename}`);
      
      const commentBody = `## 🤖 ChatGPT Review - \`${file.filename}\`

${suggestion.suggestionText}

*Note: This comment was placed at the PR level because the specific lines in the diff could not be targeted for inline comments.*`;

      await this.octokitApi.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: commentBody,
      });
      
      console.log(`✅ Successfully created general PR comment for ${file.filename}`);
      return true;
    } catch (error: any) {
      console.error(`❌ Failed to create general PR comment for ${file.filename}:`, error.message);
      return false;
    }
  }

  private getValidCommentLines(patch: string): Array<{lineNumber: number, type: 'added' | 'modified' | 'context'}> {
    const lines = patch.split('\n');
    const lineHeaderRegExp = /^@@ -\d+,\d+ \+(\d+),(\d+) @@/;
    const validLines: Array<{lineNumber: number, type: 'added' | 'modified' | 'context'}> = [];
    
    // Debug logging for patch analysis
    console.log(`🔍 Analyzing patch with ${lines.length} lines`);
    console.log('📄 Patch content preview:');
    lines.slice(0, 10).forEach((line, index) => {
      console.log(`  ${index}: "${line}"`);
    });
    if (lines.length > 10) {
      console.log(`  ... and ${lines.length - 10} more lines`);
    }
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineHeaderMatch = line.match(lineHeaderRegExp);
      
      if (lineHeaderMatch) {
        let currentNewLineNumber = parseInt(lineHeaderMatch[1], 10);
        
        console.log(`📍 Found patch header at line ${i}: "${line}"`);
        console.log(`🔢 Starting line number: ${currentNewLineNumber}`);
        
        // Parse the content after the header
        for (let j = i + 1; j < lines.length; j++) {
          const patchLine = lines[j];
          
          // Stop if we hit another patch header
          if (patchLine.startsWith('@@')) {
            console.log(`🛑 Found next patch section at line ${j}, stopping current section`);
            i = j - 1; // Set i to continue from this patch header in the outer loop
            break;
          }
          
          // Skip file headers
          if (patchLine.startsWith('+++') || patchLine.startsWith('---')) {
            console.log(`⏭️ Skipping file header: "${patchLine}"`);
            continue;
          }
          
          // Stop if we encounter what looks like a new file path (for concatenated patches)
          if (patchLine.match(/^[a-zA-Z0-9\/\-_.]+\.(php|js|ts|jsx|tsx|py|java|cpp|c|css|html|vue|rb|go|rs)$/)) {
            console.log(`🗂️ Found new file path: "${patchLine}", stopping current section`);
            i = j - 1; // Set i to continue from this line in the outer loop
            break;
          }
          
          if (patchLine.startsWith('+')) {
            // Added line - these are usually the best for comments
            validLines.push({
              lineNumber: currentNewLineNumber,
              type: 'added'
            });
            console.log(`  ✅ Added line ${currentNewLineNumber}: "${patchLine.substring(1)}"`);
            currentNewLineNumber++;
          } else if (patchLine.startsWith('-')) {
            // Removed line - check if next line is an addition (modification)
            if (j + 1 < lines.length && lines[j + 1].startsWith('+')) {
              validLines.push({
                lineNumber: currentNewLineNumber,
                type: 'modified'
              });
              console.log(`  🔄 Modified line ${currentNewLineNumber}: "${patchLine.substring(1)}"`);
            }
            // Don't increment line number for removed lines
          } else if (patchLine.startsWith(' ')) {
            // Context line - these can also be used for comments
            validLines.push({
              lineNumber: currentNewLineNumber,
              type: 'context'
            });
            currentNewLineNumber++;
          } else if (patchLine.trim() === '') {
            // Empty line
            currentNewLineNumber++;
          }
        }
        
        // Don't break here - continue looking for more patch sections
        console.log(`✅ Processed patch section, found ${validLines.length} total valid lines so far`);
      }
    }
    
    console.log(`📊 Final result: ${validLines.length} valid lines found`);
    const addedCount = validLines.filter(l => l.type === 'added').length;
    const modifiedCount = validLines.filter(l => l.type === 'modified').length;
    const contextCount = validLines.filter(l => l.type === 'context').length;
    console.log(`  ✅ Added: ${addedCount}, 🔄 Modified: ${modifiedCount}, 📄 Context: ${contextCount}`);
    
    return validLines;
  }

  private async createSkippedFilesComment(filesTooLong: string[]) {
    const { owner, repo, pullNumber } = this.pullRequest;
    
    const fileList = filesTooLong.map(file => `- \`${file}\``).join('\n');
    const tokenLimit = Math.floor(MAX_TOKENS / 2);
    
    const commentBody = `## 🤖 ChatGPT Code Review - Files Skipped

The following **${filesTooLong.length}** file(s) were skipped from automated review because they exceed the token limit (**${tokenLimit}** tokens):

${fileList}

**Why this happens:**
- Large files require more processing time and API costs
- The current limit is set to half of the configured \`max_tokens\` (${MAX_TOKENS})
- This helps ensure the review stays focused and efficient

**Recommendations:**
- 🔧 **Refactor**: Consider breaking down large files into smaller, more focused modules
- 👀 **Manual Review**: These files should be reviewed manually for best practices
- 📊 **Architecture**: Large files may indicate areas where refactoring could improve maintainability

**Configuration:**
You can adjust the \`max_tokens\` parameter in your workflow or set \`SHOW_SKIPPED_FILES_COMMENT=false\` to hide this message.

*This is an automated message from [ChatGPT Code Reviewer](https://github.com/abdullahessam/chatgpt-code-reviewer)*`;

    try {
      await this.octokitApi.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: commentBody,
      });
      console.log(`✅ Created informational comment for ${filesTooLong.length} skipped files`);
    } catch (error) {
      console.error('❌ Failed to create skipped files comment:', error);
    }
  }

  public async addCommentToPr() {
    console.log('🚀 ===== CHATGPT CODE REVIEWER STARTED =====');
    console.log(`📅 Started at: ${new Date().toISOString()}`);
    
    const { files } = await this.getBranchDiff();

    if (!files) {
      throw new Error(
        errorsConfig[ErrorMessage.NO_CHANGED_FILES_IN_PULL_REQUEST],
      );
    }

    console.log(`📁 Total files changed in PR: ${files.length}`);
    
    const patchesList: FilenameWithPatch[] = [];
    const filesTooLongToBeChecked: string[] = [];
    const tokenLimit = MAX_TOKENS / 2;

    console.log(`🔢 Token limit per file: ${tokenLimit}`);
    console.log('📊 ===== FILE ANALYSIS =====');

    for (const file of files) {
      const fileTokens = file.patch ? encode(file.patch).length : 0;
      console.log(`📄 ${file.filename}:`);
      console.log(`  📏 Patch length: ${file.patch?.length || 0} characters`);
      console.log(`  🔢 Estimated tokens: ${fileTokens}`);
      
      // Debug: Show a preview of the patch for each file
      if (file.patch) {
        console.log(`  📄 Patch preview (first 200 chars):`);
        console.log(`     "${file.patch.substring(0, 200)}${file.patch.length > 200 ? '...' : ''}"`);
        
        // Check if this patch contains multiple files (which shouldn't happen)
        const lines = file.patch.split('\n');
        const filePathLines = lines.filter(line => 
          line.match(/^[a-zA-Z0-9\/\-_.]+\.(php|js|ts|jsx|tsx|py|java|cpp|c|css|html|vue|rb|go|rs)$/)
        );
        if (filePathLines.length > 1) {
          console.warn(`  ⚠️ WARNING: This patch appears to contain multiple files: ${filePathLines.join(', ')}`);
        }
        
        // Count patch headers
        const patchHeaders = lines.filter(line => line.startsWith('@@'));
        console.log(`  📊 Patch sections found: ${patchHeaders.length}`);
      }
      
      if (file.patch && fileTokens <= tokenLimit) {
        console.log(`  ✅ INCLUDED - Within token limit`);
        patchesList.push({
          filename: file.filename,
          patch: file.patch,
          tokensUsed: encode(file.patch).length,
        });
      } else {
        console.log(`  ❌ SKIPPED - Exceeds token limit (${fileTokens} > ${tokenLimit})`);
        filesTooLongToBeChecked.push(file.filename || 'unknown file');
      }
    }

    console.log('📊 ===== PROCESSING SUMMARY =====');
    console.log(`✅ Files to review: ${patchesList.length}`);
    console.log(`❌ Files skipped: ${filesTooLongToBeChecked.length}`);
    
    if (filesTooLongToBeChecked.length > 0) {
      console.log('📋 Skipped files:');
      filesTooLongToBeChecked.forEach((filename, index) => {
        console.log(`  ${index + 1}. ${filename}`);
      });
    }

    // Log to console for debugging
    if (filesTooLongToBeChecked.length > 0) {
      console.log(
        `📊 The changes for ${filesTooLongToBeChecked.join(
          ', ',
        )} is too long to be checked (exceeds ${MAX_TOKENS / 2} tokens).`,
      );
      
      // Create an informational comment in the PR (if enabled)
      if (SHOW_SKIPPED_FILES_COMMENT) {
        await this.createSkippedFilesComment(filesTooLongToBeChecked);
      }
    }

    // Only proceed if there are files to review
    if (patchesList.length === 0) {
      console.log('ℹ️ No files to review - all files were too large or had no changes');
      return;
    }

    const listOfFilesByTokenRange = divideFilesByTokenRange(
      MAX_TOKENS / 2,
      patchesList,
    );

    console.log(`🔍 Processing ${patchesList.length} files in ${listOfFilesByTokenRange.length} batches`);

    await this.createReviewComments(listOfFilesByTokenRange[0]);

    if (listOfFilesByTokenRange.length > 1) {
      let requestCount = 1;

      const intervalId = setInterval(async () => {
        if (requestCount >= listOfFilesByTokenRange.length) {
          clearInterval(intervalId);
          return;
        }

        console.log(`🔄 Processing batch ${requestCount + 1}/${listOfFilesByTokenRange.length}`);
        await this.createReviewComments(listOfFilesByTokenRange[requestCount]);
        requestCount += 1;
      }, OPENAI_TIMEOUT);
    }
  }
}

export default CommentOnPullRequestService;
