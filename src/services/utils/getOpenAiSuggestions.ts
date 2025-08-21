import { getInput } from '@actions/core';
import fetch from 'node-fetch';

import errorsConfig, { ErrorMessage } from '../../config/errorsConfig';
import promptsConfig, { Prompt } from '../../config/promptsConfig';

const OPENAI_MODEL = getInput('model') || 'gpt-3.5-turbo';
const MAX_TOKENS = parseInt(getInput('max_tokens'), 10) || 4096;

const getOpenAiSuggestions = async (patch: string): Promise<any> => {
  if (!patch) {
    throw new Error(
      errorsConfig[ErrorMessage.MISSING_PATCH_FOR_OPENAI_SUGGESTION],
    );
  }

  // 📊 Log detailed information about what's being sent to OpenAI
  console.log('🚀 ===== OPENAI REQUEST DETAILS =====');
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log(`🎯 Max Tokens: ${MAX_TOKENS}`);
  console.log(`📏 Patch Length: ${patch.length} characters`);
  console.log(`🔢 Estimated Tokens: ~${Math.ceil(patch.length / 4)} tokens`);
  
  // Log system prompt
  console.log('💬 System Prompt:');
  console.log(promptsConfig[Prompt.SYSTEM_PROMPT]);
  
  // Log the actual patch data being sent
  console.log('📝 Patch Data Being Sent to OpenAI:');
  console.log('--- START PATCH ---');
  console.log(patch);
  console.log('--- END PATCH ---');

  const requestBody = {
    model: OPENAI_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system', content: promptsConfig[Prompt.SYSTEM_PROMPT] },
      { role: 'user', content: patch },
    ],
  };

  console.log('📦 Full Request Body:');
  console.log(JSON.stringify(requestBody, null, 2));
  console.log('🚀 ===== SENDING REQUEST TO OPENAI =====');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer  ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`📡 Response Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      console.error(`❌ OpenAI API Error: ${response.status} - ${response.statusText}`);
      throw new Error(`Failed to post data: ${response.status} ${response.statusText}`);
    }

    const responseJson = (await response.json()) as any;
    
    // 📊 Log detailed response information
    console.log('✅ ===== OPENAI RESPONSE DETAILS =====');
    console.log(`📊 Response received at: ${new Date().toISOString()}`);
    console.log('📦 Full Response JSON:');
    console.log(JSON.stringify(responseJson, null, 2));
    
    if (responseJson.usage) {
      console.log('💰 Token Usage:');
      console.log(`  📥 Prompt tokens: ${responseJson.usage.prompt_tokens}`);
      console.log(`  📤 Completion tokens: ${responseJson.usage.completion_tokens}`);
      console.log(`  📊 Total tokens: ${responseJson.usage.total_tokens}`);
    }

    const openAiSuggestion =
      responseJson.choices.shift()?.message?.content || '';

    console.log('💡 Extracted Suggestion:');
    console.log('--- START AI RESPONSE ---');
    console.log(openAiSuggestion);
    console.log('--- END AI RESPONSE ---');
    console.log('✅ ===== OPENAI PROCESSING COMPLETE =====');

    return openAiSuggestion;
  } catch (error) {
    console.error('❌ ===== OPENAI ERROR =====');
    console.error('Error posting data:', error);
    console.error('❌ ===== END ERROR =====');
    throw error;
  }
};

export default getOpenAiSuggestions;
