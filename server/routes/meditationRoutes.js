// server/routes/meditationRoutes.js
import { Router } from 'express';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import Meditation from '../models/Meditation.js';
import jwt from 'jsonwebtoken';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Authentication middleware
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Save a meditation
router.post('/save', requireAuth, async (req, res) => {
  try {
    const { goals, styles, duration, script, audioUrl } = req.body;
    
    // Validate required fields
    if (!goals || !styles || !duration || !script || !audioUrl) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: 'All fields are required: goals, styles, duration, script, audioUrl'
      });
    }

    console.log('Creating meditation with data:', {
      userId: req.user.id,
      goals,
      styles,
      duration,
      audioUrl,
      script: script.substring(0, 50) + '...' // Log just the start of the script
    });

    const meditation = new Meditation({
      userId: req.user.id,
      goals,
      styles,
      duration,
      script,
      audioUrl
    });

    const savedMeditation = await meditation.save();
    console.log('Meditation saved successfully:', savedMeditation._id);

    res.json({ 
      message: 'Meditation saved successfully', 
      meditation: savedMeditation 
    });
  } catch (error) {
    console.error('Error saving meditation:', error);
    res.status(500).json({ 
      error: 'Failed to save meditation', 
      details: error.message 
    });
  }
});

// Get all meditations for the user
router.get('/', requireAuth, async (req, res) => {
  try {
    console.log('Fetching meditations for user:', req.user.id);
    const meditations = await Meditation.find({ userId: req.user.id })
      .sort({ createdAt: -1 });
    console.log('Found meditations:', meditations.length);
    res.json(meditations);
  } catch (error) {
    console.error('Error fetching meditations:', error);
    res.status(500).json({ error: 'Failed to fetch meditations' });
  }
});

// Delete a meditation
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const meditation = await Meditation.findOne({ _id: id, userId: req.user.id });
    
    if (!meditation) {
      return res.status(404).json({ error: 'Meditation not found' });
    }

    await meditation.deleteOne();
    res.json({ message: 'Meditation deleted successfully' });
  } catch (error) {
    console.error('Error deleting meditation:', error);
    res.status(500).json({ error: 'Failed to delete meditation' });
  }
});

// Add helper function to calculate script duration
function calculateScriptDuration(script) {
  // Average speaking rate (words per minute)
  const WORDS_PER_MINUTE = 130;
  const WORDS_PER_SECOND = WORDS_PER_MINUTE / 60;

  // Count words in script (excluding pause placeholders)
  const words = script.replace(/{{PAUSE_\d+s}}/g, '').split(/\s+/).length;
  
  // Calculate speaking time in seconds
  const speakingTime = words / WORDS_PER_SECOND;
  
  // Calculate total pause time
  const pauseMatches = script.match(/{{PAUSE_(\d+)s}}/g) || [];
  const pauseTime = pauseMatches.reduce((total, pause) => {
    const seconds = parseInt(pause.match(/\d+/)[0]);
    return total + seconds;
  }, 0);
  
  // Total duration in seconds
  return Math.round(speakingTime + pauseTime);
}

// Add helper function to adjust script duration
function adjustScriptDuration(script, currentDuration, targetDuration) {
  const diffSeconds = targetDuration * 60 - currentDuration;
  
  if (Math.abs(diffSeconds) <= 30) {
    // If within 30 seconds of target, it's close enough
    return script;
  }

  if (diffSeconds > 0) {
    // Need to add time - increase pause durations
    return script.replace(/{{PAUSE_(\d+)s}}/g, (match, seconds) => {
      const newDuration = Math.round(parseInt(seconds) * (targetDuration * 60 / currentDuration));
      return `{{PAUSE_${newDuration}s}}`;
    });
  } else {
    // Need to reduce time - decrease pause durations
    return script.replace(/{{PAUSE_(\d+)s}}/g, (match, seconds) => {
      const newDuration = Math.max(2, Math.round(parseInt(seconds) * (targetDuration * 60 / currentDuration)));
      return `{{PAUSE_${newDuration}s}}`;
    });
  }
}

// Add helper function to calculate max tokens based on duration
function calculateMaxTokens(durationMinutes) {
  // Base: 2000 tokens for 7 minutes
  const baseTokens = 2000;
  const baseMinutes = 7;
  
  // Calculate required tokens with a 20% buffer
  const calculatedTokens = Math.ceil((durationMinutes / baseMinutes) * baseTokens * 1.2);
  
  // Cap at 4096 (GPT-4's limit) and ensure minimum of 2000
  return Math.min(4096, Math.max(2000, calculatedTokens));
}

// Add helper function to expand script
async function expandScript(script, currentDuration, targetDuration, style) {
  const expansionFactor = Math.min(3, targetDuration * 60 / currentDuration);
  const maxTokens = calculateMaxTokens(targetDuration);
  
  const expansionPrompt = `
You are expanding a meditation script. You MUST keep ALL existing content and add new content to reach the target duration.

Current script duration: ${Math.round(currentDuration / 60)} minutes
Target duration: ${targetDuration} minutes
Required expansion: Add ${Math.round(expansionFactor * 100 - 100)}% more content

IMPORTANT RULES:
1. NEVER remove or modify existing content
2. ONLY ADD new content between existing sections
3. Keep the same style and flow as the original
4. Use varied, non-repetitive language in new content
5. Add new sections that complement existing ones
6. Maintain "${style}" meditation style throughout
7. Add appropriate {{PAUSE_Xs}} placeholders between new sections

Example of good expansion:
Original:
"Take a deep breath in... {{PAUSE_3s}} And release... {{PAUSE_3s}}"

Expanded (good):
"Take a deep breath in... {{PAUSE_3s}} And release... {{PAUSE_3s}}
Now, feel the weight of your body... {{PAUSE_3s}} Notice where you make contact with the surface below... {{PAUSE_5s}}
Take another deep breath in... {{PAUSE_3s}} And let it flow out naturally... {{PAUSE_3s}}"

Here's the script to expand. Remember to KEEP ALL EXISTING CONTENT and ADD MORE content between sections:

${script}
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { 
        role: 'system', 
        content: 'You are a meditation script expander. You must preserve all existing content and only add new content to reach the target duration. Never remove or modify existing text.'
      },
      { 
        role: 'user', 
        content: expansionPrompt 
      }
    ],
    temperature: 0.7,
    max_tokens: maxTokens,
    presence_penalty: 0.7,
    frequency_penalty: 0.9,
  });

  if (!response.choices?.[0]?.message?.content) {
    throw new Error('Invalid response from OpenAI API during expansion');
  }

  let expandedScript = response.choices[0].message.content.trim();
  
  // Verify that all original content is preserved
  const originalWords = script.split(/\s+/);
  const expandedWords = expandedScript.split(/\s+/);
  
  // If the expanded version is shorter, something went wrong - retry with stricter prompt
  if (expandedWords.length <= originalWords.length) {
    console.log('Expansion failed to increase length, retrying with stricter prompt...');
    return expandScript(script, currentDuration, targetDuration, style);
  }
  
  // Post-process to remove any immediate word repetitions
  expandedScript = expandedScript.replace(/(\b\w+\b)(\s+\1\b)+/gi, '$1');
  
  return expandedScript;
}

// Add back the script generation route
router.post('/generate', async (req, res) => {
  try {
    console.log('Received meditation generation request:', {
      body: req.body,
      contentType: req.headers['content-type']
    });

    const { duration, style, extraNotes } = req.body || {};
    
    if (!duration || !style) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: 'Duration and style are required',
        receivedBody: req.body
      });
    }

    console.log('Generating meditation script with:', {
      duration,
      style,
      extraNotes: extraNotes || 'none'
    });

    // Verify OpenAI API key is set
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key is not configured');
    }
    
    // Check cache first
    const cacheKey = generateCacheKey(duration, style, extraNotes);
    const cachedResult = scriptCache.get(cacheKey);
    
    if (cachedResult && (Date.now() - cachedResult.timestamp < CACHE_DURATION)) {
      console.log('Returning cached meditation script');
      return res.json({ script: cachedResult.script });
    }

    // Optimize the prompt for faster generation
    const prompt = `
Create a ${duration}-minute meditation script. Style: ${style}. Goals: ${extraNotes}
Format: Natural spoken language with {{PAUSE_Xs}} placeholders for pauses.
Guidelines:
- Use {{PAUSE_15s}} for major transitions, breathing time, visualization time etc.
- Use {{PAUSE_8s}} between instructions
- Use {{PAUSE_3s}} for brief pauses
- Target 130 words per minute of speaking time
- Focus on clarity and brevity
- Include settling period at start
- End with gentle return to awareness
    `;

    console.log('Making OpenAI API call...');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2000,
      presence_penalty: 0,
      frequency_penalty: 0,
    });

    if (!response.choices || !response.choices[0] || !response.choices[0].message) {
      console.error('Invalid OpenAI API response:', response);
      throw new Error('Invalid response from OpenAI API');
    }

    const generatedScript = response.choices[0].message.content.trim();
    console.log('Script generated successfully');

    // Cache the result
    scriptCache.set(cacheKey, {
      script: generatedScript,
      timestamp: Date.now()
    });

    console.log('Successfully generated meditation script');
    return res.json({ script: generatedScript });
  } catch (error) {
    console.error('Error generating meditation script:', error);
    if (error.response) {
      console.error('OpenAI API error response:', error.response.data);
    }
    return res.status(500).json({ 
      error: 'Failed to generate script.',
      details: error.message,
      apiError: error.response?.data
    });
  }
});

// Add back the cache-related code at the top
const scriptCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function generateCacheKey(duration, style, extraNotes) {
  const data = `${duration}-${style}-${extraNotes}`;
  return crypto.createHash('md5').update(data).digest('hex');
}

// Clean old cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of scriptCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      scriptCache.delete(key);
    }
  }
}, CACHE_DURATION);

export default router;

