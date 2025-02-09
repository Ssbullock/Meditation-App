// server/routes/ttsRoutes.js
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import OpenAI from 'openai';
import { mkdir } from 'fs/promises';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import lodash from 'lodash';
const { debounce } = lodash;
import { createReadStream } from 'fs';
import Redis from 'ioredis';
import { Worker } from 'worker_threads';
import Queue from 'bull';
import { GridFSBucket, MongoClient } from 'mongodb';
import { Readable } from 'stream';
import { ObjectId } from 'mongodb';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tempDir = path.join(__dirname, '../temp');
const audioDir = path.join(__dirname, '../public/audio');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

// Ensure directories exist on startup
(async () => {
  try {
    await fs.promises.mkdir(tempDir, { recursive: true });
    await fs.promises.mkdir(audioDir, { recursive: true });
    console.log('Audio directories created successfully');
  } catch (error) {
    console.error('Error creating directories:', error);
  }
})();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Semaphore for controlling concurrent generations
let activeGenerations = 0;
const MAX_CONCURRENT = 3;

// Simple queue implementation
const queue = [];

function generateChunkCacheKey(text, voice, model) {
  const data = `${text}-${voice}-${model}`;
  return crypto.createHash('md5').update(data).digest('hex');
}

async function processQueue() {
  if (activeGenerations >= MAX_CONCURRENT || queue.length === 0) return;
  
  const { text, voice, model, resolve, reject } = queue.shift();
  activeGenerations++;

  try {
    const result = await generateTTS(text, voice, model);
    resolve(result);
  } catch (error) {
    reject(error);
  } finally {
    activeGenerations--;
    processQueue(); // Process next item in queue
  }
}

// Add silence generation function
async function generateSilence(seconds, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input('anullsrc')
      .inputOptions([
        '-f', 'lavfi',
        '-t', seconds.toString()
      ])
      .outputOptions([
        '-c:a', 'libmp3lame',
        '-b:a', '128k'
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// Update chunkText to handle silence markers
function chunkText(text, maxLength = 4000) {
  // Split by silence markers while preserving them
  const parts = text.split(/(\{\{PAUSE_\d+s\}\})/g);
  const chunks = [];
  let currentChunk = '';

  for (const part of parts) {
    const silenceMatch = part.match(/\{\{PAUSE_(\d+)s\}\}/);
    
    if (silenceMatch) {
      // If we have accumulated text, push it as a chunk
      if (currentChunk) {
        chunks.push({ type: 'text', content: currentChunk.trim() });
        currentChunk = '';
      }
      // Push silence as a separate chunk
      chunks.push({ type: 'silence', duration: parseInt(silenceMatch[1], 10) });
      continue;
    }

    // Handle text chunks
    if ((currentChunk + part).length <= maxLength) {
      currentChunk += part;
    } else {
      if (currentChunk) chunks.push({ type: 'text', content: currentChunk.trim() });
      currentChunk = part;
    }
  }

  if (currentChunk) chunks.push({ type: 'text', content: currentChunk.trim() });
  return chunks;
}

// Add MongoDB connection and GridFS setup
let gridFSBucket;
const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017';

// Initialize MongoDB connection
async function initMongoDB() {
  try {
    const client = await MongoClient.connect(mongoUrl);
    const db = client.db(process.env.MONGODB_DB || 'meditation-app');
    gridFSBucket = new GridFSBucket(db, {
      bucketName: 'audio'
    });
    console.log('MongoDB GridFS initialized successfully');
  } catch (error) {
    console.error('MongoDB GridFS initialization failed:', error);
  }
}

initMongoDB();

// Helper function to upload to GridFS
async function uploadToGridFS(buffer, filename) {
  try {
    // Create a readable stream from the buffer
    const readableStream = Readable.from(buffer);
    
    // Create a unique filename to avoid collisions
    const uniqueFilename = `${Date.now()}-${filename}`;
    
    // Upload to GridFS
    const uploadStream = gridFSBucket.openUploadStream(uniqueFilename, {
      contentType: 'audio/mpeg'
    });
    
    await new Promise((resolve, reject) => {
      readableStream
        .pipe(uploadStream)
        .on('error', reject)
        .on('finish', resolve);
    });

    return `/audio/${uploadStream.id}`;
  } catch (error) {
    console.error('GridFS upload error:', error);
    throw error;
  }
}

// Add this function before mergeAudioBuffers
async function mergeAudioFiles(files, outputPath) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();
    
    // Add input files
    files.forEach(file => {
      command.input(file);
    });

    // Configure the merge
    command
      .on('error', (err) => {
        console.error('Error merging audio files:', err);
        reject(err);
      })
      .on('end', () => {
        console.log('Audio merge completed');
        resolve();
      })
      // Use the concat filter to merge audio files
      .complexFilter([
        {
          filter: 'concat',
          options: {
            n: files.length, // number of input files
            v: '0',         // no video
            a: '1'          // audio only
          }
        }
      ])
      // Set output options
      .outputOptions([
        '-acodec', 'libmp3lame',  // use MP3 codec
        '-ab', '128k',            // audio bitrate
        '-ar', '44100'            // sample rate
      ])
      .save(outputPath);          // save to output file
  });
}

// Modify the generateTTS function
async function generateTTS(text, voice = 'alloy', model = 'tts-1') {
  try {
    const chunks = chunkText(text);
    const results = [];

    for (const chunk of chunks) {
      if (chunk.type === 'silence') {
        const silenceFile = await getOrCreateSilence(chunk.duration);
        const silenceBuffer = await fs.promises.readFile(silenceFile);
        const silenceUrl = await uploadToGridFS(
          silenceBuffer, 
          `silence-${chunk.duration}s.mp3`
        );
        results.push({ url: silenceUrl, isTemp: true });
        continue;
      }

      // Handle text chunks
      const cacheKey = generateChunkCacheKey(chunk.content, voice, model);
      const fileName = `chunk-${cacheKey}.mp3`;

      try {
        // Try to find existing file in GridFS
        const files = await gridFSBucket.find({ filename: fileName }).toArray();
        if (files.length > 0) {
          results.push({ url: `/audio/${files[0]._id}`, isTemp: false });
          continue;
        }
      } catch (error) {
        // File doesn't exist, generate new one
      }

      const mp3Response = await openai.audio.speech.create({
        model: model,
        voice: voice,
        input: chunk.content,
      });

      if (!mp3Response) {
        throw new Error('No response from OpenAI TTS API');
      }

      const buffer = Buffer.from(await mp3Response.arrayBuffer());
      const url = await uploadToGridFS(buffer, fileName);
      results.push({ url, isTemp: false });
    }

    // If there's only one chunk and it's not temporary, return it directly
    if (results.length === 1 && !results[0].isTemp) {
      return { audioUrl: results[0].url };
    }

    // Merge all chunks
    const mergedBuffer = await mergeAudioBuffers(results.map(r => r.url));
    
    // Upload merged file to GridFS
    const finalUrl = await uploadToGridFS(
      mergedBuffer,
      `merged-${Date.now()}.mp3`
    );

    // Clean up temporary files from GridFS
    for (const result of results) {
      if (result.isTemp) {
        try {
          const fileId = result.url.split('/').pop();
          await gridFSBucket.delete(new ObjectId(fileId));
        } catch (error) {
          console.error('Error deleting temporary file:', error);
        }
      }
    }

    return { audioUrl: finalUrl };
  } catch (error) {
    console.error('Error generating TTS:', error);
    throw error;
  }
}

// Update mergeAudioBuffers to properly handle GridFS files
async function mergeAudioBuffers(urls) {
  // Create temp directory if it doesn't exist
  await fs.promises.mkdir(tempDir, { recursive: true });

  // Download all files to temp directory
  const tempFiles = await Promise.all(urls.map(async (url, index) => {
    try {
      // Extract ID from URL
      const fileId = url.split('/').pop();
      const objectId = new ObjectId(fileId);
      
      // Create a temporary file path
      const tempFile = path.join(tempDir, `temp-${index}-${Date.now()}.mp3`);
      
      // Create write stream
      const writeStream = fs.createWriteStream(tempFile);
      
      // Get file from GridFS and pipe to temp file
      const downloadStream = gridFSBucket.openDownloadStream(objectId);
      await new Promise((resolve, reject) => {
        downloadStream
          .pipe(writeStream)
          .on('error', reject)
          .on('finish', resolve);
      });

      return tempFile;
    } catch (error) {
      console.error(`Error processing audio file ${url}:`, error);
      throw error;
    }
  }));

  // Merge files
  const outputPath = path.join(tempDir, `merged-${Date.now()}.mp3`);
  try {
    await mergeAudioFiles(tempFiles, outputPath);
    const mergedBuffer = await fs.promises.readFile(outputPath);
    
    // Clean up temp files
    await Promise.all([
      ...tempFiles.map(file => fs.promises.unlink(file).catch(console.error)),
      fs.promises.unlink(outputPath).catch(console.error)
    ]);

    return mergedBuffer;
  } catch (error) {
    // Clean up temp files on error
    await Promise.all(tempFiles.map(file => 
      fs.promises.unlink(file).catch(console.error)
    ));
    throw error;
  }
}

router.post('/generate-audio', async (req, res) => {
  const { 
    text, 
    voice = 'alloy',     // Default voice
    model = 'tts-1'      // Default model
  } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  try {
    const result = await new Promise((resolve, reject) => {
      queue.push({ 
        text, 
        voice, 
        model,
        resolve, 
        reject 
      });
      processQueue();
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to generate audio',
      details: error.message
    });
  }
});

// Add audio chunk cache
const audioChunkCache = new Map();
const CHUNK_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Add cache cleanup interval
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of audioChunkCache.entries()) {
    if (now - value.timestamp > CHUNK_CACHE_DURATION) {
      // Delete the cached file
      if (fs.existsSync(value.path)) {
        fs.unlinkSync(value.path);
      }
      audioChunkCache.delete(key);
    }
  }
}, CHUNK_CACHE_DURATION);

// Optimize silence generation with pre-generated silence files
const SILENCE_CACHE = new Map();
async function getOrCreateSilence(seconds) {
  const key = Math.round(seconds * 10) / 10; // Round to nearest 0.1s
  
  if (SILENCE_CACHE.has(key)) {
    return SILENCE_CACHE.get(key);
  }

  const silenceFile = path.join(tempDir, `silence-${key}s.mp3`);
  
  // If file exists on disk, use it
  if (fs.existsSync(silenceFile)) {
    SILENCE_CACHE.set(key, silenceFile);
    return silenceFile;
  }

  // Generate new silence file
  await generateSilence(seconds, silenceFile);
  SILENCE_CACHE.set(key, silenceFile);
  return silenceFile;
}

// Optimize the parsePlaceholders function to handle all pauses efficiently
function parsePlaceholders(script) {
  const blocks = [];
  const MAX_CHUNK_LENGTH = 4000; // Maximize chunk size while staying under limit

  // Split by all pauses while keeping them
  const segments = script
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(\{\{PAUSE_\d+s\}\})/g)
    .filter(Boolean); // Remove empty segments immediately
  
  let currentChunk = '';
  let currentPause = 0;

  for (const segment of segments) {
    const pauseMatch = segment.trim().match(/\{\{PAUSE_(\d+)s\}\}/);
    if (pauseMatch) {
      if (currentChunk) {
        blocks.push({ text: currentChunk, pause: currentPause });
        currentChunk = '';
      }
      blocks.push({ text: '', pause: parseInt(pauseMatch[1], 10) });
      currentPause = 0;
      continue;
    }

    if ((currentChunk + ' ' + segment).length <= MAX_CHUNK_LENGTH) {
      currentChunk = currentChunk ? currentChunk + ' ' + segment : segment;
    } else {
      if (currentChunk) blocks.push({ text: currentChunk, pause: currentPause });
      currentChunk = segment;
      currentPause = 0;
    }
  }

  if (currentChunk) blocks.push({ text: currentChunk, pause: currentPause });
  return blocks;
}

// Update Redis implementation with better error handling
let redis;
const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => {
    if (times > 3) {
      console.log('Redis connection failed, falling back to in-memory cache');
      return null; // Stop retrying
    }
    return Math.min(times * 100, 3000); // Exponential backoff
  },
  enableOfflineQueue: false,
  lazyConnect: true // Don't connect immediately
};

try {
  redis = new Redis(process.env.REDIS_URL || REDIS_CONFIG);
  
  redis.on('error', (err) => {
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      console.log('Redis connection failed, falling back to in-memory cache');
      redis = null;
    } else {
      console.error('Redis error:', err);
    }
  });

  // Test the connection
  redis.ping().catch(() => {
    console.log('Redis ping failed, falling back to in-memory cache');
    redis = null;
  });
} catch (error) {
  console.log('Redis initialization failed, falling back to in-memory cache');
  redis = null;
}

/**
 * Helper to generate TTS for a single block with caching
 */
async function generateTTSForBlock(block, voice, model, index) {
  try {
    // Handle pause blocks efficiently
    if (!block.text && block.pause > 0) {
      return await getOrCreateSilence(block.pause);
    }

    if (!block.text) return null;

    // Generate cache key
    const cacheKey = generateChunkCacheKey(block.text, voice, model);
    
    // Try cache (Redis if available, otherwise in-memory)
    if (redis && redis.status === 'ready') {
      try {
        const cachedPath = await redis.get(`tts:${cacheKey}`);
        if (cachedPath && fs.existsSync(cachedPath)) {
          return cachedPath;
        }
      } catch (error) {
        console.log('Redis cache retrieval failed, using in-memory cache');
      }
    }

    // Fallback to in-memory cache
    const cached = audioChunkCache.get(cacheKey);
    if (cached && fs.existsSync(cached.path)) {
      return cached.path;
    }

    // Generate TTS for text block
    const mp3Response = await openai.audio.speech.create({
      model,
      voice,
      input: block.text,
    });

    if (!mp3Response) {
      throw new Error('No response from OpenAI TTS API');
    }

    const buffer = Buffer.from(await mp3Response.arrayBuffer());
    const outFile = `chunk-${cacheKey}.mp3`;
    const outPath = path.join(tempDir, outFile);
    await fs.promises.writeFile(outPath, buffer);
    
    // Cache the result (Redis if available, otherwise in-memory)
    if (redis && redis.status === 'ready') {
      try {
        await redis.set(`tts:${cacheKey}`, outPath, 'EX', 86400); // 24h expiry
      } catch (error) {
        console.log('Redis cache storage failed, using in-memory cache only');
      }
    }
    
    // Always cache in memory as fallback
    audioChunkCache.set(cacheKey, {
      path: outPath,
      timestamp: Date.now()
    });
    
    return outPath;
  } catch (error) {
    console.error(`Error generating TTS for block ${index}:`, error);
    return null;
  }
}

/**
 * Helper to merge chunks more efficiently using FFmpeg concat demuxer
 */
async function mergeChunksEfficiently(files, outputPath) {
  const ffmpeg = require('fluent-ffmpeg');
  
  return new Promise((resolve, reject) => {
    let command = ffmpeg();
    
    // Stream inputs directly
    files.forEach(file => {
      command = command.input(file);
    });

    command
      .complexFilter([
        // Optimize filter graph
        files.map((_, i) => `[${i}:a]`).join('') + 
        `concat=n=${files.length}:v=0:a=1[out]`
      ])
      .outputOptions([
        '-map', '[out]',
        '-c:a', 'libmp3lame',
        '-q:a', '2',
        '-movflags', '+faststart'
      ])
      .on('progress', progress => {
        // Report progress
      })
      .save(outputPath);
  });
}

const audioQueue = new Queue('audio-processing');

// Worker process
audioQueue.process(async (job) => {
  const blocks = parsePlaceholders(job.data.text);
  const OPTIMAL_BATCH_SIZE = determineOptimalBatchSize(blocks.length);
  
  const workers = new Array(4).fill(null).map(() => 
    new Worker('./audioWorker.js')
  );

  // Distribute work across workers
  const results = await processBlocksWithWorkers(blocks, workers);
  return await mergeResults(results);
});

// Add merge cache
const mergeCache = new Map();
const MERGE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Add merge cache cleanup interval
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of mergeCache.entries()) {
    if (now - value.timestamp > MERGE_CACHE_DURATION) {
      if (fs.existsSync(value.path)) {
        fs.unlinkSync(value.path);
      }
      mergeCache.delete(key);
    }
  }
}, MERGE_CACHE_DURATION);

function generateMergeCacheKey(ttsUrl, musicUrl, volume) {
  const data = `${ttsUrl}-${musicUrl}-${volume}`;
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * POST /api/tts/mix-with-music
 * Body: { ttsUrl: string, musicUrl: string, ttsVolume: number, musicVolume: number }
 * merges final TTS file with background music
 */
router.post('/mix-with-music', async (req, res) => {
  const startTime = Date.now();
  const { ttsUrl, musicUrl, musicVolume = 0.3, ttsVolume = 1.0 } = req.body;
  
  try {
    if (!ttsUrl || !musicUrl) {
      return res.status(400).json({ error: 'Missing ttsUrl or musicUrl' });
    }

    const ttsPath = path.join(__dirname, '../public', ttsUrl);
    const musicPath = path.join(__dirname, '../public', musicUrl);

    if (!fs.existsSync(ttsPath) || !fs.existsSync(musicPath)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    // Check cache first
    const cacheKey = generateMergeCacheKey(ttsUrl, musicUrl, musicVolume);
    const cachedMerge = mergeCache.get(cacheKey);
    if (cachedMerge && fs.existsSync(cachedMerge.path)) {
      return res.json({ 
        mixedAudioUrl: cachedMerge.url,
        mergeTime: (Date.now() - startTime) / 1000,
        cached: true
      });
    }

    const outputFileName = `merged-${cacheKey}.mp3`;
    const outputPath = path.join(audioDir, outputFileName);
    const outputUrl = `/audio/${outputFileName}`;

    // Use fluent-ffmpeg for mixing
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(ttsPath)
        .input(musicPath)
        .complexFilter([
          `[0:a]volume=${ttsVolume}[tts]`,
          `[1:a]volume=${musicVolume}[music]`,
          '[tts][music]amix=inputs=2:duration=longest[out]'
        ])
        .outputOptions([
          '-map', '[out]',
          '-c:a', 'libmp3lame',
          '-q:a', '2',
          '-movflags', '+faststart'
        ])
        .on('end', () => {
          mergeCache.set(cacheKey, {
            path: outputPath,
            url: outputUrl,
            timestamp: Date.now()
          });
          resolve();
        })
        .on('error', (error) => {
          console.error('Error mixing audio:', error);
          reject(error);
        })
        .save(outputPath);
    });

    res.json({ 
      mixedAudioUrl: outputUrl,
      mergeTime: (Date.now() - startTime) / 1000,
      cached: false
    });

  } catch (error) {
    console.error('Error merging audio:', error);
    res.status(500).json({ 
      error: 'Failed to merge audio',
      details: error.message
    });
  }
});

// Helper function to get audio metadata
function getAudioMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata);
    });
  });
}

// Rate limiting
router.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
}));

// Compression
router.use(compression());

// Efficient cleanup
const CLEANUP_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
const OPTIMAL_BATCH_SIZE = 10;

// Helper function to determine optimal batch size
function determineOptimalBatchSize(totalBlocks) {
  const maxBatchSize = 25;
  const minBatchSize = 5;
  return Math.min(maxBatchSize, Math.max(minBatchSize, Math.ceil(totalBlocks / 4)));
}

// Helper function to process blocks with workers
async function processBlocksWithWorkers(blocks, workers) {
  const batchSize = determineOptimalBatchSize(blocks.length);
  const batches = [];
  
  for (let i = 0; i < blocks.length; i += batchSize) {
    batches.push(blocks.slice(i, i + batchSize));
  }

  const results = await Promise.all(
    batches.map((batch, index) => {
      const worker = workers[index % workers.length];
      return new Promise((resolve, reject) => {
        worker.postMessage({ batch });
        worker.once('message', resolve);
        worker.once('error', reject);
      });
    })
  );

  return results.flat();
}

// Helper function to merge results
async function mergeResults(results) {
  const validFiles = results.filter(Boolean);
  if (!validFiles.length) {
    throw new Error('No valid audio files generated');
  }

  const finalFileName = `meditation-${Date.now()}.mp3`;
  const finalPath = path.join(audioDir, finalFileName);
  await mergeChunksEfficiently(validFiles, finalPath);

  return {
    audioUrl: `/audio/${finalFileName}`,
    generationTime: Date.now() - results.startTime,
    chunksProcessed: results.length
  };
}

// Optimize cleanup function
const cleanup = debounce(async () => {
  try {
    const files = await fs.promises.readdir(tempDir);
    const now = Date.now();
    
    const filesToDelete = await Promise.all(
      files.map(async file => {
        const stats = await fs.promises.stat(path.join(tempDir, file));
        return {
          file,
          shouldDelete: now - stats.mtime > CLEANUP_THRESHOLD
        };
      })
    );

    await Promise.all(
      filesToDelete
        .filter(({ shouldDelete }) => shouldDelete)
        .map(({ file }) => fs.promises.unlink(path.join(tempDir, file)))
    );
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}, 1000);

// Update the audio serving route
router.get('/audio/:id', async (req, res) => {
  try {
    const id = new ObjectId(req.params.id);
    
    // Set proper audio headers
    res.set({
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'
    });

    // Create download stream from GridFS
    const downloadStream = gridFSBucket.openDownloadStream(id);
    
    // Handle errors on the stream
    downloadStream.on('error', (error) => {
      console.error('Error streaming audio:', error);
      if (!res.headersSent) {
        res.status(404).json({ error: 'Audio file not found' });
      }
    });

    // Pipe the file to the response
    downloadStream.pipe(res);
  } catch (error) {
    console.error('Error serving audio file:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to serve audio file',
        details: error.message 
      });
    }
  }
});

export default router;