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
    const suggestionsListText = await getOpenAiSuggestions(
      concatenatePatchesToString(files),
    );
    const suggestionsByFile = parseOpenAISuggestions(suggestionsListText);
    const { owner, repo, pullNumber } = this.pullRequest;
    const lastCommitId = await this.getLastCommit();

    for (const file of files) {
      const suggestionForFile = suggestionsByFile.find(
        (suggestion) => suggestion.filename === file.filename,
      );

      if (suggestionForFile) {
        try {
          const consoleTimeLabel = `Comment was created successfully for file: ${file.filename}`;
          console.time(consoleTimeLabel);

          // Try different strategies to place the comment on the right line
          const success = await this.tryCreateLineComment(
            file,
            suggestionForFile,
            { owner, repo, pullNumber, lastCommitId }
          );

          if (!success) {
            console.warn(`All line comment strategies failed for ${file.filename}, this should not happen`);
          }

          console.timeEnd(consoleTimeLabel);
        } catch (error) {
          console.error(
            `An error occurred while trying to add a comment to ${file.filename}:`,
            error,
          );
          // Don't throw here, continue with other files
        }
      }
    }
  }

  private async tryCreateLineComment(
    file: FilenameWithPatch,
    suggestion: any,
    context: { owner: string; repo: string; pullNumber: number; lastCommitId: string }
  ): Promise<boolean> {
    const { owner, repo, pullNumber, lastCommitId } = context;
    
    // Parse the patch to get line information
    const validLines = this.getValidCommentLines(file.patch);
    
    console.log(`Valid comment lines for ${file.filename}:`, validLines);
    
    // Strategy 1: Try the first added line
    for (const lineInfo of validLines) {
      if (lineInfo.type === 'added') {
        try {
          console.log(`Trying to comment on added line ${lineInfo.lineNumber} in ${file.filename}`);
          
          await this.octokitApi.rest.pulls.createReviewComment({
            owner,
            repo,
            pull_number: pullNumber,
            line: lineInfo.lineNumber,
            path: file.filename,
            body: `[ChatGPTReviewer]\n${suggestion.suggestionText}`,
            commit_id: lastCommitId,
          });
          
          console.log(`✅ Successfully commented on line ${lineInfo.lineNumber}`);
          return true;
        } catch (error: any) {
          console.warn(`❌ Failed to comment on added line ${lineInfo.lineNumber}:`, error.message);
        }
      }
    }
    
    // Strategy 2: Try the first modified line (if no added lines worked)
    for (const lineInfo of validLines) {
      if (lineInfo.type === 'modified') {
        try {
          console.log(`Trying to comment on modified line ${lineInfo.lineNumber} in ${file.filename}`);
          
          await this.octokitApi.rest.pulls.createReviewComment({
            owner,
            repo,
            pull_number: pullNumber,
            line: lineInfo.lineNumber,
            path: file.filename,
            body: `[ChatGPTReviewer]\n${suggestion.suggestionText}`,
            commit_id: lastCommitId,
          });
          
          console.log(`✅ Successfully commented on modified line ${lineInfo.lineNumber}`);
          return true;
        } catch (error: any) {
          console.warn(`❌ Failed to comment on modified line ${lineInfo.lineNumber}:`, error.message);
        }
      }
    }
    
    // Strategy 3: Try any valid line from the patch
    for (const lineInfo of validLines) {
      try {
        console.log(`Trying to comment on any valid line ${lineInfo.lineNumber} in ${file.filename}`);
        
        await this.octokitApi.rest.pulls.createReviewComment({
          owner,
          repo,
          pull_number: pullNumber,
          line: lineInfo.lineNumber,
          path: file.filename,
          body: `[ChatGPTReviewer]\n${suggestion.suggestionText}`,
          commit_id: lastCommitId,
        });
        
        console.log(`✅ Successfully commented on line ${lineInfo.lineNumber}`);
        return true;
      } catch (error: any) {
        console.warn(`❌ Failed to comment on line ${lineInfo.lineNumber}:`, error.message);
      }
    }
    
    return false;
  }

  private getValidCommentLines(patch: string): Array<{lineNumber: number, type: 'added' | 'modified' | 'context'}> {
    const lines = patch.split('\n');
    const lineHeaderRegExp = /^@@ -\d+,\d+ \+(\d+),(\d+) @@/;
    const validLines: Array<{lineNumber: number, type: 'added' | 'modified' | 'context'}> = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineHeaderMatch = line.match(lineHeaderRegExp);
      
      if (lineHeaderMatch) {
        let currentNewLineNumber = parseInt(lineHeaderMatch[1], 10);
        
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
          
          if (patchLine.startsWith('+')) {
            // Added line - these are usually the best for comments
            validLines.push({
              lineNumber: currentNewLineNumber,
              type: 'added'
            });
            currentNewLineNumber++;
          } else if (patchLine.startsWith('-')) {
            // Removed line - check if next line is an addition (modification)
            if (j + 1 < lines.length && lines[j + 1].startsWith('+')) {
              validLines.push({
                lineNumber: currentNewLineNumber,
                type: 'modified'
              });
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
        
        break; // Process only the first patch section for now
      }
    }
    
    return validLines;
  }

  public async addCommentToPr() {
    const { files } = await this.getBranchDiff();

    if (!files) {
      throw new Error(
        errorsConfig[ErrorMessage.NO_CHANGED_FILES_IN_PULL_REQUEST],
      );
    }

    const patchesList: FilenameWithPatch[] = [];
    const filesTooLongToBeChecked: string[] = [];

    for (const file of files) {
      if (file.patch && encode(file.patch).length <= MAX_TOKENS / 2) {
        patchesList.push({
          filename: file.filename,
          patch: file.patch,
          tokensUsed: encode(file.patch).length,
        });
      } else {
        filesTooLongToBeChecked.push(file.filename);
      }
    }

    if (filesTooLongToBeChecked.length > 0) {
      console.log(
        `The changes for ${filesTooLongToBeChecked.join(
          ', ',
        )} is too long to be checked.`,
      );
    }

    const listOfFilesByTokenRange = divideFilesByTokenRange(
      MAX_TOKENS / 2,
      patchesList,
    );

    await this.createReviewComments(listOfFilesByTokenRange[0]);

    if (listOfFilesByTokenRange.length > 1) {
      let requestCount = 1;

      const intervalId = setInterval(async () => {
        if (requestCount >= listOfFilesByTokenRange.length) {
          clearInterval(intervalId);
          return;
        }

        await this.createReviewComments(listOfFilesByTokenRange[requestCount]);
        requestCount += 1;
      }, OPENAI_TIMEOUT);
    }
  }
}

export default CommentOnPullRequestService;
