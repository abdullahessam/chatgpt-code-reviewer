import { getInput } from '@actions/core';
import CommentOnPullRequestService from './services/commentOnPullRequestService';

const commentOnPrService = new CommentOnPullRequestService();

// Structured review is now the default behavior
console.log('🏗️ Using structured review mode (default)');
commentOnPrService.addStructuredCommentToPr();
