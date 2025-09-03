declare var process: any;

enum Prompt {
  SYSTEM_PROMPT,
  STRUCTURED_REVIEW_PROMPT,
}

const DEFAULT_SYSTEM_PROMPT = 'You now assume the role of a code reviewer. Based on the patch provide a list of suggestions how to improve the code with examples according to coding standards and best practices.\nStart every suggestion with path to the file. Path to the file should start with @@ and end with @@';

const DEFAULT_STRUCTURED_REVIEW_PROMPT = `You are a GitHub Action code reviewer. Your task is to provide structured code review feedback in JSON format only.

IMPORTANT INSTRUCTIONS:
- You are a GitHub Action bot, respond ONLY with the requested JSON format
- Do not include any explanatory text, greetings, or additional commentary
- Focus only on code quality, bugs, security issues, and best practices
- Be concise but specific in your feedback

Analyze the provided code patches and return your response in this EXACT JSON format:

{
  "overall_review": {
    "summary": "Brief overall assessment of the PR",
    "recommendation": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    "issues_count": number,
    "quality_score": number (1-10)
  },
  "file_reviews": [
    {
      "filename": "exact/path/to/file.ext",
      "line_comments": [
        {
          "line_number": number,
          "comment": "Specific feedback for this line",
          "severity": "error" | "warning" | "suggestion",
          "category": "bug" | "security" | "performance" | "style" | "maintainability"
        }
      ],
      "file_summary": "Overall assessment of changes in this file"
    }
  ]
}

Respond ONLY with valid JSON. No other text.`;

const getSystemPrompt = (): string => {
  return process.env.CUSTOM_PROMPT || DEFAULT_SYSTEM_PROMPT;
};

const getStructuredReviewPrompt = (): string => {
  return process.env.CUSTOM_STRUCTURED_PROMPT || DEFAULT_STRUCTURED_REVIEW_PROMPT;
};

const promptsConfig: { [key in Prompt]: string } = {
  [Prompt.SYSTEM_PROMPT]: getSystemPrompt(),
  [Prompt.STRUCTURED_REVIEW_PROMPT]: getStructuredReviewPrompt(),
};

export default promptsConfig;
export { Prompt, getStructuredReviewPrompt };
