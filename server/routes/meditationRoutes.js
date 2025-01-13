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

// Add back the script generation route
router.post('/generate', async (req, res) => {
  try {
    const { duration, style, extraNotes } = req.body;
    
    if (!duration || !style) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: 'Duration and style are required'
      });
    }

    console.log('Generating meditation script with:', {
      duration,
      style,
      extraNotes: extraNotes || 'none'
    });
    
    // Check cache first
    const cacheKey = generateCacheKey(duration, style, extraNotes);
    const cachedResult = scriptCache.get(cacheKey);
    
    if (cachedResult && (Date.now() - cachedResult.timestamp < CACHE_DURATION)) {
      return res.json({ script: cachedResult.script });
    }

    // Optimize the prompt for faster generation
    const prompt = `
Create a ${duration}-minute meditation script. Style: ${style}. Goals: ${extraNotes}
Format: Natural spoken language with {{PAUSE_Xs}} placeholders for pauses.
Guidelines:
- Use {{PAUSE_15s}} for major transitions
- Use {{PAUSE_8s}} between instructions
- Use {{PAUSE_3s}} for brief pauses
- Target 130 words per minute of speaking time
- Focus on clarity and brevity
- Include settling period at start
- End with gentle return to awareness
    `;

    // First API call to generate the initial script
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2000,
      presence_penalty: 0,
      frequency_penalty: 0,
    });

    if (!response.choices || !response.choices[0] || !response.choices[0].message) {
      throw new Error('Invalid response from OpenAI API');
    }

    const generatedScript = response.choices[0].message.content.trim();

    // Create a new prompt for the second API call
    const enhancementPrompt = `
Please expand on the following meditation script to enhance the user's experience. 
Make sure to add more short pauses of 2-3 seconds to improve the flow of the meditation. 
Ensure that the meditation fits the allotted time of ${duration} minutes. Feel free to add more repetitions or 
expand or certain parts to make the meditation the appropriate length. 

Here is the initial script:
${generatedScript}
    `;

    // Second API call to enhance the meditation script
    const enhancedResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: enhancementPrompt }],
      temperature: 0.7,
      max_tokens: 2000,
      presence_penalty: 0,
      frequency_penalty: 0,
    });

    if (!enhancedResponse.choices || !enhancedResponse.choices[0] || !enhancedResponse.choices[0].message) {
      throw new Error('Invalid response from OpenAI API during enhancement');
    }

    const enhancedScript = enhancedResponse.choices[0].message.content.trim();

    // Cache the result
    scriptCache.set(cacheKey, {
      script: enhancedScript,
      timestamp: Date.now()
    });

    console.log('Successfully generated meditation script');
    return res.json({ script: enhancedScript });
  } catch (error) {
    console.error('Error generating meditation script:', error);
    return res.status(500).json({ 
      error: 'Failed to generate script.',
      details: error.message 
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

