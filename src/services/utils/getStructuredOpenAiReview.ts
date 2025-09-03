import { getInput } from '@actions/core';
import fetch from 'node-fetch';

import errorsConfig, { ErrorMessage } from '../../config/errorsConfig';
import { getStructuredReviewPrompt } from '../../config/promptsConfig';
import { StructuredReviewResponse } from '../types';

const OPENAI_MODEL = getInput('model') || 'gpt-3.5-turbo';
const MAX_TOKENS = parseInt(getInput('max_tokens'), 10) || 4096;

const getStructuredOpenAiReview = async (patches: string): Promise<StructuredReviewResponse> => {
  if (!patches) {
    throw new Error(
      errorsConfig[ErrorMessage.MISSING_PATCH_FOR_OPENAI_SUGGESTION],
    );
  }

  // 🔍 Validate configuration before making request
  console.log('🔍 ===== VALIDATING CONFIGURATION FOR STRUCTURED REVIEW =====');
  
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }
  
  const apiKeyPreview = process.env.OPENAI_API_KEY.substring(0, 7) + '...';
  console.log(`🔑 API Key format: ${apiKeyPreview} (length: ${process.env.OPENAI_API_KEY.length})`);
  
  if (!process.env.OPENAI_API_KEY.startsWith('sk-')) {
    console.warn('⚠️ Warning: API key does not start with "sk-" - this might be invalid');
  }
  
  console.log(`🤖 Model: ${OPENAI_MODEL}`);
  console.log(`🎯 Max Tokens: ${MAX_TOKENS}`);
  
  if (MAX_TOKENS < 1 || MAX_TOKENS > 128000) {
    throw new Error(`Invalid max_tokens value: ${MAX_TOKENS}. Must be between 1 and 128000`);
  }

  // 📊 Log detailed information about what's being sent to OpenAI
  console.log('🚀 ===== STRUCTURED REVIEW REQUEST DETAILS =====');
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  console.log(`📏 Patches Length: ${patches.length} characters`);
  console.log(`🔢 Estimated Tokens: ~${Math.ceil(patches.length / 4)} tokens`);
  
  // Log system prompt
  const structuredPrompt = getStructuredReviewPrompt();
  console.log('💬 Structured Review Prompt Length:', structuredPrompt.length);
  
  // Log the actual patch data being sent
  console.log('📝 Patches Data Being Sent to OpenAI:');
  console.log('--- START PATCHES ---');
  console.log(patches);
  console.log('--- END PATCHES ---');

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
      { role: 'system', content: structuredPrompt },
      { role: 'user', content: patches },
    ],
    response_format: { type: "json_object" }, // Force JSON response
    temperature: 0.3, // Lower temperature for more consistent structured output
  };

  // 🔍 Validate request body before sending
  console.log('🔍 ===== VALIDATING STRUCTURED REQUEST BODY =====');
  console.log(`✅ Model: ${requestBody.model}`);
  console.log(`✅ ${tokenParam}: ${requestBody[tokenParam]}`);
  console.log(`✅ Response format: JSON object enforced`);
  console.log(`✅ Temperature: ${requestBody.temperature}`);
  console.log(`✅ Total messages: ${requestBody.messages.length}`);

  console.log('📦 Full Request Body:');
  console.log(JSON.stringify(requestBody, null, 2));
  console.log('🚀 ===== SENDING STRUCTURED REVIEW REQUEST TO OPENAI =====');

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
    console.log('✅ ===== STRUCTURED REVIEW RESPONSE DETAILS =====');
    console.log(`📊 Response received at: ${new Date().toISOString()}`);
    console.log('📦 Full Response JSON:');
    console.log(JSON.stringify(responseJson, null, 2));
    
    if (responseJson.usage) {
      console.log('💰 Token Usage:');
      console.log(`  📥 Prompt tokens: ${responseJson.usage.prompt_tokens}`);
      console.log(`  📤 Completion tokens: ${responseJson.usage.completion_tokens}`);
      console.log(`  📊 Total tokens: ${responseJson.usage.total_tokens}`);
    }

    const openAiResponse = responseJson.choices.shift()?.message?.content || '';

    console.log('🔍 Raw AI Response:');
    console.log('--- START AI RESPONSE ---');
    console.log(openAiResponse);
    console.log('--- END AI RESPONSE ---');

    // 🔍 Parse and validate the JSON response
    let structuredReview: StructuredReviewResponse;
    
    try {
      structuredReview = JSON.parse(openAiResponse);
      console.log('✅ Successfully parsed JSON response');
    } catch (parseError) {
      console.error('❌ Failed to parse JSON response:', parseError);
      console.error('📝 Raw response that failed to parse:', openAiResponse);
      
      // Fallback: create a structured response from the raw text
      structuredReview = {
        overall_review: {
          summary: "Failed to parse structured response, falling back to basic review",
          recommendation: "COMMENT",
          issues_count: 0,
          quality_score: 5
        },
        file_reviews: [{
          filename: "unknown",
          line_comments: [{
            line_number: 1,
            comment: openAiResponse || "No response received",
            severity: "suggestion",
            category: "maintainability"
          }],
          file_summary: "Unable to parse structured review"
        }]
      };
    }

    // 🔍 Validate the structure
    console.log('🔍 ===== VALIDATING STRUCTURED RESPONSE =====');
    
    if (!structuredReview.overall_review) {
      console.warn('⚠️ Missing overall_review, adding default');
      structuredReview.overall_review = {
        summary: "Review completed",
        recommendation: "COMMENT",
        issues_count: structuredReview.file_reviews?.length || 0,
        quality_score: 7
      };
    }
    
    if (!structuredReview.file_reviews || !Array.isArray(structuredReview.file_reviews)) {
      console.warn('⚠️ Missing or invalid file_reviews, adding default');
      structuredReview.file_reviews = [];
    }

    console.log(`✅ Overall Review: ${structuredReview.overall_review.summary}`);
    console.log(`✅ Recommendation: ${structuredReview.overall_review.recommendation}`);
    console.log(`✅ Issues Count: ${structuredReview.overall_review.issues_count}`);
    console.log(`✅ Quality Score: ${structuredReview.overall_review.quality_score}/10`);
    console.log(`✅ File Reviews: ${structuredReview.file_reviews.length} files`);
    
    for (const fileReview of structuredReview.file_reviews) {
      console.log(`  📁 ${fileReview.filename}: ${fileReview.line_comments?.length || 0} comments`);
    }

    console.log('✅ ===== STRUCTURED REVIEW PROCESSING COMPLETE =====');

    return structuredReview;
  } catch (error) {
    console.error('❌ ===== STRUCTURED REVIEW ERROR =====');
    console.error('Error getting structured review:', error);
    console.error('❌ ===== END ERROR =====');
    throw error;
  }
};

export default getStructuredOpenAiReview;
