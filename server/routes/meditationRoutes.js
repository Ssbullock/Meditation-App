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

// Add helper function to expand script
async function expandScript(script, currentDuration, targetDuration, style) {
  const expansionFactor = Math.min(3, targetDuration * 60 / currentDuration);
  
  const expansionPrompt = `
Please expand this meditation script to be ${Math.round(expansionFactor * 100)}% longer while maintaining the same style and flow.
Current duration: ${Math.round(currentDuration / 60)} minutes
Target duration: ${targetDuration} minutes

Guidelines for expansion:
1. Add more detailed instructions and descriptions
2. Include more repetitions of key exercises
3. Add longer pauses between sections
4. Maintain the "${style}" meditation style
5. Keep the same general structure but expand each section
6. Ensure smooth transitions between expanded sections

Original script:
${script}
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: expansionPrompt }],
    temperature: 0.7,
    max_tokens: 2000,
    presence_penalty: 0.2,
    frequency_penalty: 0.4,
  });

  if (!response.choices?.[0]?.message?.content) {
    throw new Error('Invalid response from OpenAI API during expansion');
  }

  return response.choices[0].message.content.trim();
}

// Update the generate route
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

    // Calculate target words based on duration
    const targetWords = Math.round((duration * 130) * 0.6); // 60% of time for speaking
    
    // Initial prompt for script generation
    const prompt = `
Create a ${duration}-minute meditation script. Style: ${style}. Goals: ${extraNotes}
Format: Natural spoken language with {{PAUSE_Xs}} placeholders for pauses.
Guidelines:
- Target exactly ${targetWords} words of speaking content
- Use {{PAUSE_15s}} for major transitions
- Use {{PAUSE_8s}} between instructions
- Use {{PAUSE_3s}} for brief pauses
- Include settling period at start (30-45 seconds)
- End with gentle return to awareness (30 seconds)
- Distribute pauses evenly throughout the script
- Total duration must be exactly ${duration} minutes
    `;

    console.log('Making first OpenAI API call...');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2000,
      presence_penalty: 0,
      frequency_penalty: 0,
    });

    if (!response.choices?.[0]?.message?.content) {
      throw new Error('Invalid response from OpenAI API');
    }

    let generatedScript = response.choices[0].message.content.trim();
    let scriptDuration = calculateScriptDuration(generatedScript);
    console.log('Initial script duration:', scriptDuration, 'seconds');

    // Iteratively expand the script until we reach the target duration
    let iterations = 0;
    const maxIterations = 3;
    
    while (scriptDuration < duration * 60 * 0.9 && iterations < maxIterations) { // Allow 10% under target
      console.log(`Iteration ${iterations + 1}: Expanding script...`);
      generatedScript = await expandScript(generatedScript, scriptDuration, duration, style);
      scriptDuration = calculateScriptDuration(generatedScript);
      console.log(`Expanded script duration: ${scriptDuration} seconds`);
      iterations++;
    }

    // Final adjustment of pause durations if needed
    if (Math.abs(scriptDuration - duration * 60) > 30) {
      console.log('Final adjustment of pause durations...');
      generatedScript = adjustScriptDuration(generatedScript, scriptDuration, duration);
      scriptDuration = calculateScriptDuration(generatedScript);
      console.log('Final script duration:', scriptDuration, 'seconds');
    }

    // Cache the result
    scriptCache.set(cacheKey, {
      script: generatedScript,
      timestamp: Date.now()
    });

    console.log('Successfully generated meditation script');
    return res.json({ 
      script: generatedScript,
      calculatedDuration: Math.round(scriptDuration / 60),
      durationDetails: {
        requestedMinutes: duration,
        actualSeconds: scriptDuration,
        difference: Math.abs(scriptDuration - duration * 60),
        iterations: iterations
      }
    });
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

