// server/routes/ttsRoutes.js
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import OpenAI from 'openai';
import { mkdir } from 'fs/promises';
import crypto from 'crypto';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tempDir = path.join(__dirname, '../temp');
const audioDir = path.join(__dirname, '../public/audio');

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

// Initialize the new OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

function generateChunkCacheKey(text, voice, model) {
  const data = `${text}-${voice}-${model}`;
  return crypto.createHash('md5').update(data).digest('hex');
}

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
  const MAX_CHUNK_LENGTH = 4000;

  // Split by all pauses while keeping them
  const segments = script
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(\{\{PAUSE_\d+s\}\})/g);
  
  let currentChunk = '';
  let currentPause = 0;

  for (let segment of segments) {
    segment = segment.trim();
    if (!segment) continue;

    const pauseMatch = segment.match(/\{\{PAUSE_(\d+)s\}\}/);
    if (pauseMatch) {
      const pauseDuration = parseInt(pauseMatch[1], 10);
      // If we have text accumulated, push it with any previous pause
      if (currentChunk) {
        blocks.push({ text: currentChunk, pause: currentPause });
        currentChunk = '';
        currentPause = 0;
      }
      // Add pause block
      blocks.push({ text: '', pause: pauseDuration });
      continue;
    }

    // For text segments, try to accumulate until we reach max length
    if ((currentChunk + ' ' + segment).length <= MAX_CHUNK_LENGTH) {
      currentChunk = currentChunk ? currentChunk + ' ' + segment : segment;
    } else {
      if (currentChunk) {
        blocks.push({ text: currentChunk, pause: currentPause });
        currentPause = 0;
      }
      currentChunk = segment;
    }
  }

  // Push any remaining chunk
  if (currentChunk) {
    blocks.push({ text: currentChunk, pause: currentPause });
  }

  return blocks;
}

/**
 * Helper to generate TTS for a single block with caching
 */
async function generateTTSForBlock(block, voice, model, index) {
  // Handle pause blocks more efficiently
  if (!block.text && block.pause > 0) {
    return await getOrCreateSilence(block.pause);
  }

  if (!block.text) return null;

  // Check cache first
  const cacheKey = generateChunkCacheKey(block.text, voice, model);
  const cachedChunk = audioChunkCache.get(cacheKey);
  if (cachedChunk && fs.existsSync(cachedChunk.path)) {
    return cachedChunk.path;
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
  
  // Cache the chunk
  audioChunkCache.set(cacheKey, {
    path: outPath,
    timestamp: Date.now()
  });
  
  return outPath;
}

/**
 * Helper to merge chunks more efficiently using FFmpeg concat demuxer
 */
async function mergeChunksEfficiently(files, outputPath) {
  if (files.length === 0) {
    throw new Error('No files to merge');
  }

  // If there's only one file, just copy it
  if (files.length === 1) {
    await fs.promises.copyFile(files[0], outputPath);
    return;
  }

  // Create a temporary WAV file for intermediate processing
  const tempWavPath = path.join(tempDir, `temp-${Date.now()}.wav`);
  const listPath = path.join(tempDir, `list-${Date.now()}.txt`);
  const fileContent = files.map(f => `file '${f}'`).join('\n');
  await fs.promises.writeFile(listPath, fileContent);

  try {
    // First merge to WAV for better quality
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-acodec', 'pcm_s16le',
          '-ar', '44100',
          '-ac', '2',
          '-f', 'wav'
        ])
        .on('error', reject)
        .on('end', resolve)
        .save(tempWavPath);
    });

    // Then convert to MP3 with high quality settings
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(tempWavPath)
        .outputOptions([
          '-codec:a', 'libmp3lame',
          '-qscale:a', '2',
          '-ar', '44100',
          '-ac', '2',
          '-id3v2_version', '3',
          '-write_xing', '1'
        ])
        .on('error', reject)
        .on('end', resolve)
        .save(outputPath);
    });
  } finally {
    // Clean up temporary files
    if (fs.existsSync(listPath)) {
      fs.unlinkSync(listPath);
    }
    if (fs.existsSync(tempWavPath)) {
      fs.unlinkSync(tempWavPath);
    }
  }
}

/**
 * POST /api/tts/generate-audio
 */
router.post('/generate-audio', async (req, res) => {
  const startTime = Date.now();
  try {
    const { text, voice = 'alloy', model = 'tts-1' } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    const blocks = parsePlaceholders(text);
    console.log(`Processing ${blocks.length} blocks...`);

    // Maximum parallel processing
    const MAX_CONCURRENT = 25;
    const chunkFiles = [];
    let processed = 0;

    // Process blocks in parallel with maximum concurrency
    for (let i = 0; i < blocks.length; i += MAX_CONCURRENT) {
      const batch = blocks.slice(i, Math.min(i + MAX_CONCURRENT, blocks.length));
      
      const results = await Promise.all(
        batch.map(block => generateTTSForBlock(block, voice, model, i))
      );

      chunkFiles.push(...results.filter(Boolean));
      processed += batch.length;
      console.log(`Progress: ${Math.round((processed / blocks.length) * 100)}%`);
    }

    if (chunkFiles.length === 0) {
      throw new Error('No audio chunks were generated');
    }

    // Merge chunks
    const finalFileName = `meditation-${Date.now()}.mp3`;
    const finalPath = path.join(audioDir, finalFileName);
    await mergeChunksEfficiently(chunkFiles, finalPath);

    // Clean up non-cached temp files
    const tempFiles = chunkFiles.filter(file => 
      file && !file.includes('chunk-') && !file.includes('silence-')
    );
    for (const file of tempFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }

    const generationTime = (Date.now() - startTime) / 1000;
    console.log(`Generated in ${generationTime}s`);

    return res.json({ 
      audioUrl: `/audio/${finalFileName}`, 
      generationTime,
      chunksProcessed: blocks.length,
      cached: blocks.length - chunkFiles.length
    });
  } catch (error) {
    console.error('Error generating TTS audio:', error);
    return res.status(500).json({ 
      error: 'Failed to generate audio',
      details: error.message
    });
  }
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

    console.log('Starting audio merge with:', {
      ttsUrl,
      musicUrl,
      musicVolume,
      ttsVolume
    });

    const ttsPath = path.join(__dirname, '../public', ttsUrl);
    const musicPath = path.join(__dirname, '../public', musicUrl);

    if (!fs.existsSync(ttsPath) || !fs.existsSync(musicPath)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    // Check cache first
    const cacheKey = generateMergeCacheKey(ttsUrl, musicUrl, musicVolume);
    const cachedMerge = mergeCache.get(cacheKey);
    if (cachedMerge && fs.existsSync(cachedMerge.path)) {
      console.log('Using cached merged audio');
      const endTime = Date.now();
      return res.json({ 
        mixedAudioUrl: cachedMerge.url,
        mergeTime: (endTime - startTime) / 1000,
        cached: true
      });
    }

    // Get the duration of both files in parallel
    const [ttsMetadata, musicMetadata] = await Promise.all([
      getAudioMetadata(ttsPath),
      getAudioMetadata(musicPath)
    ]);

    const ttsDuration = ttsMetadata.format.duration;
    console.log(`TTS duration: ${ttsDuration}s`);

    const outputFileName = `merged-${cacheKey}.mp3`;
    const outputPath = path.join(audioDir, outputFileName);
    const outputUrl = `/audio/${outputFileName}`;

    // Create a temporary WAV file for intermediate processing
    const tempWavPath = path.join(tempDir, `temp-${Date.now()}.wav`);

    await new Promise((resolve, reject) => {
      let lastProgress = 0;
      
      ffmpeg()
        .input(ttsPath)
        .input(musicPath)
        .complexFilter([
          `[1:a]aloop=loop=-1:size=${ttsDuration}[looped]`,
          `[looped]atrim=0:${ttsDuration},volume=${musicVolume}[music]`,
          `[0:a]volume=${ttsVolume}[tts]`,
          `[tts][music]amerge=inputs=2[out]`
        ])
        .outputOptions([
          '-map', '[out]',
          '-acodec', 'pcm_s16le',
          '-ar', '44100',
          '-ac', '2'
        ])
        .on('start', (cmd) => console.log('Started FFmpeg with command:', cmd))
        .on('progress', (progress) => {
          if (progress.percent) {
            const realProgress = Math.min(Math.round(progress.percent), 100);
            if (realProgress > lastProgress) {
              lastProgress = realProgress;
              console.log(`Merge progress: ${realProgress}%`);
            }
          }
        })
        .on('error', reject)
        .on('end', () => {
          // Convert WAV to MP3 with high quality settings
          ffmpeg(tempWavPath)
            .outputOptions([
              '-codec:a', 'libmp3lame',
              '-qscale:a', '2',
              '-ar', '44100',
              '-ac', '2',
              '-id3v2_version', '3',
              '-write_xing', '1'
            ])
            .on('end', () => {
              if (fs.existsSync(tempWavPath)) {
                fs.unlinkSync(tempWavPath);
              }
              mergeCache.set(cacheKey, {
                path: outputPath,
                url: outputUrl,
                timestamp: Date.now()
              });
              resolve();
            })
            .on('error', (err) => {
              if (fs.existsSync(tempWavPath)) {
                fs.unlinkSync(tempWavPath);
              }
              reject(err);
            })
            .save(outputPath);
        })
        .save(tempWavPath);
    });

    const endTime = Date.now();
    const mergeTime = (endTime - startTime) / 1000;
    console.log(`Total merge time: ${mergeTime} seconds`);

    return res.json({ 
      mixedAudioUrl: outputUrl,
      mergeTime,
      cached: false
    });

  } catch (error) {
    console.error('Error merging audio:', error);
    return res.status(500).json({ 
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

async function generateSilence(seconds, outputPath) {
  return new Promise((resolve, reject) => {
    // Create a silent PCM file first
    const sampleRate = 44100;
    const channels = 2;
    const frameCount = Math.floor(sampleRate * seconds);
    const silenceBuffer = Buffer.alloc(frameCount * channels * 2); // 2 bytes per sample

    // Write WAV header
    const wavHeader = Buffer.alloc(44);
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + silenceBuffer.length, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(channels, 22);
    wavHeader.writeUInt32LE(sampleRate, 24);
    wavHeader.writeUInt32LE(sampleRate * channels * 2, 28);
    wavHeader.writeUInt16LE(channels * 2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(silenceBuffer.length, 40);

    // Write temporary WAV file
    const tempWavFile = path.join(tempDir, `silence-${Date.now()}.wav`);
    fs.writeFileSync(tempWavFile, Buffer.concat([wavHeader, silenceBuffer]));

    // Convert WAV to MP3
    ffmpeg()
      .input(tempWavFile)
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .on('end', () => {
        // Clean up temporary WAV file
        fs.unlinkSync(tempWavFile);
        resolve();
      })
      .on('error', (err) => {
        // Clean up on error too
        if (fs.existsSync(tempWavFile)) {
          fs.unlinkSync(tempWavFile);
        }
        reject(err);
      })
      .save(outputPath);
  });
}

export default router;
