declare var process: any;

enum Prompt {
  SYSTEM_PROMPT,
}

const DEFAULT_SYSTEM_PROMPT = 'You now assume the role of a code reviewer. Based on the patch provide a list of suggestions how to improve the code with examples according to coding standards and best practices.\nStart every suggestion with path to the file. Path to the file should start with @@ and end with @@';

const getSystemPrompt = (): string => {
  return process.env.CUSTOM_PROMPT || DEFAULT_SYSTEM_PROMPT;
};

const promptsConfig: { [key in Prompt]: string } = {
  [Prompt.SYSTEM_PROMPT]: getSystemPrompt(),
};

export default promptsConfig;
export { Prompt };
