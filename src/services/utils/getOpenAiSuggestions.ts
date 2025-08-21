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

  // � Validate configuration before making request
  console.log('� ===== VALIDATING CONFIGURATION =====');
  
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }
  
  const apiKeyPreview = process.env.OPENAI_API_KEY.substring(0, 7) + '...';
  console.log(`� API Key format: ${apiKeyPreview} (length: ${process.env.OPENAI_API_KEY.length})`);
  
  if (!process.env.OPENAI_API_KEY.startsWith('sk-')) {
    console.warn('⚠️ Warning: API key does not start with "sk-" - this might be invalid');
  }
  
  if (!OPENAI_MODEL) {
    throw new Error('Model is not specified');
  }
  
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log(`🎯 Max Tokens: ${MAX_TOKENS}`);
  
  if (MAX_TOKENS < 1 || MAX_TOKENS > 128000) {
    throw new Error(`Invalid max_tokens value: ${MAX_TOKENS}. Must be between 1 and 128000`);
  }

  // 📊 Log detailed information about what's being sent to OpenAI
  console.log('🚀 ===== OPENAI REQUEST DETAILS =====');
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
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

  // 🔧 Determine the correct token parameter based on model
  const isLegacyModel = OPENAI_MODEL.includes('gpt-3.5-turbo-instruct') || 
                       OPENAI_MODEL.includes('text-davinci') ||
                       OPENAI_MODEL.includes('text-curie') ||
                       OPENAI_MODEL.includes('text-babbage') ||
                       OPENAI_MODEL.includes('text-ada');
  
  const tokenParam = isLegacyModel ? 'max_tokens' : 'max_completion_tokens';
  
  console.log(`🔧 Using token parameter: ${tokenParam} (model: ${OPENAI_MODEL})`);

  const requestBody = {
    model: OPENAI_MODEL,
    [tokenParam]: MAX_TOKENS,
    messages: [
      { role: 'system', content: promptsConfig[Prompt.SYSTEM_PROMPT] },
      { role: 'user', content: patch },
    ],
  };

  // 🔍 Validate request body before sending
  console.log('🔍 ===== VALIDATING REQUEST BODY =====');
  
  if (!requestBody.model || requestBody.model.trim() === '') {
    throw new Error('Model cannot be empty');
  }
  
  if (!requestBody.messages || requestBody.messages.length === 0) {
    throw new Error('Messages array cannot be empty');
  }
  
  const systemMessage = requestBody.messages.find(m => m.role === 'system');
  const userMessage = requestBody.messages.find(m => m.role === 'user');
  
  if (!systemMessage || !systemMessage.content) {
    throw new Error('System message is missing or empty');
  }
  
  if (!userMessage || !userMessage.content) {
    throw new Error('User message is missing or empty');
  }
  
  console.log(`✅ Model: ${requestBody.model}`);
  console.log(`✅ ${tokenParam}: ${requestBody[tokenParam]}`);
  console.log(`✅ System message length: ${systemMessage.content.length} chars`);
  console.log(`✅ User message length: ${userMessage.content.length} chars`);
  console.log(`✅ Total messages: ${requestBody.messages.length}`);

  console.log('📦 Full Request Body:');
  console.log(JSON.stringify(requestBody, null, 2));
  console.log('🚀 ===== SENDING REQUEST TO OPENAI =====');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`📡 Response Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      console.error(`❌ OpenAI API Error: ${response.status} - ${response.statusText}`);
      
      // Try to get the detailed error response
      let errorDetails = '';
      try {
        const errorResponse = await response.text();
        console.error('📋 Detailed Error Response:');
        console.error(errorResponse);
        errorDetails = ` - ${errorResponse}`;
      } catch (parseError) {
        console.error('Failed to parse error response:', parseError);
      }
      
      throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}${errorDetails}`);
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
