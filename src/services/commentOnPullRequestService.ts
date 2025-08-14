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
      const patchInfo = parsePatchForChanges(file.patch);
      const suggestionForFile = suggestionsByFile.find(
        (suggestion) => suggestion.filename === file.filename,
      );

      if (suggestionForFile) {
        try {
          const consoleTimeLabel = `Comment was created successfully for file: ${file.filename}`;
          console.time(consoleTimeLabel);

          // Determine the best line to comment on
          let targetLine = patchInfo.firstChangedLine;
          
          // If we have specific added lines, use the first one
          if (patchInfo.addedLines.length > 0) {
            targetLine = patchInfo.addedLines[0];
          } else if (patchInfo.modifiedLines.length > 0) {
            targetLine = patchInfo.modifiedLines[0];
          }

          console.log(`Attempting to comment on line ${targetLine} for file ${file.filename}`);

          try {
            await this.octokitApi.rest.pulls.createReviewComment({
              owner,
              repo,
              pull_number: pullNumber,
              line: targetLine,
              path: suggestionForFile.filename,
              body: `[ChatGPTReviewer]\n${suggestionForFile.suggestionText}`,
              commit_id: lastCommitId,
            });
          } catch (lineError: any) {
            console.warn(`Failed to create line comment for ${file.filename} at line ${targetLine}:`, lineError.message);
            
            // Try using the side parameter for better compatibility
            try {
              await this.octokitApi.rest.pulls.createReviewComment({
                owner,
                repo,
                pull_number: pullNumber,
                line: targetLine,
                side: 'RIGHT',
                path: suggestionForFile.filename,
                body: `[ChatGPTReviewer]\n${suggestionForFile.suggestionText}`,
                commit_id: lastCommitId,
              });
            } catch (sideError: any) {
              console.warn(`Failed to create side comment, falling back to patch start line:`, sideError.message);
              
              // Final fallback: use the patch start line
              const patchStartLine = this.extractPatchStartLine(file.patch);
              
              await this.octokitApi.rest.pulls.createReviewComment({
                owner,
                repo,
                pull_number: pullNumber,
                line: patchStartLine,
                path: suggestionForFile.filename,
                body: `[ChatGPTReviewer]\n${suggestionForFile.suggestionText}`,
                commit_id: lastCommitId,
              });
            }
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

  private extractPatchStartLine(patch: string): number {
    const lineHeaderRegExp = /^@@ -\d+,\d+ \+(\d+),(\d+) @@/;
    const lines = patch.split('\n');
    const lineHeaderMatch = lines[0].match(lineHeaderRegExp);
    
    return lineHeaderMatch ? parseInt(lineHeaderMatch[1], 10) : 1;
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
