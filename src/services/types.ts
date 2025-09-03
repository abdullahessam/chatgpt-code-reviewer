import { getOctokit } from '@actions/github';

type Octokit = ReturnType<typeof getOctokit>;

type FilenameWithPatch = {
  filename: string;
  patch: string;
  tokensUsed: number;
};

type PullRequestInfo = {
  owner: string;
  repo: string;
  pullHeadRef: string;
  pullBaseRef: string;
  pullNumber: number;
};

type LineComment = {
  line_number: number;
  comment: string;
  severity: 'error' | 'warning' | 'suggestion';
  category: 'bug' | 'security' | 'performance' | 'style' | 'maintainability';
};

type FileReview = {
  filename: string;
  line_comments: LineComment[];
  file_summary: string;
};

type OverallReview = {
  summary: string;
  recommendation: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  issues_count: number;
  quality_score: number;
};

type StructuredReviewResponse = {
  overall_review: OverallReview;
  file_reviews: FileReview[];
};

export type { 
  Octokit, 
  FilenameWithPatch, 
  PullRequestInfo, 
  LineComment, 
  FileReview, 
  OverallReview, 
  StructuredReviewResponse 
};
