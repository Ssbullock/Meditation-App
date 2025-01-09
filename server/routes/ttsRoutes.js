// server/routes/ttsRoutes.js
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import OpenAI from 'openai';
import { mkdir } from 'fs/promises';

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

/**
 * Helper: parse script with placeholders like {{PAUSE_5s}} and add natural pauses
 * Returns an array of { text: string, pause: number }.
 */
function parsePlaceholders(script) {
  const blocks = [];
  const MAX_CHUNK_LENGTH = 4000;

  // First, normalize the script to ensure consistent spacing
  const normalizedScript = script.replace(/\s+/g, ' ').trim();
  
  // Split by pause placeholders but keep them in the result
  const segments = normalizedScript.split(/(\{\{PAUSE_\d+s\}\})/);
  
  for (let segment of segments) {
    segment = segment.trim();
    if (!segment) continue;

    // Handle pause placeholders
    const pauseMatch = segment.match(/\{\{PAUSE_(\d+)s\}\}/);
    if (pauseMatch) {
      blocks.push({ text: '', pause: parseInt(pauseMatch[1], 10) });
      continue;
    }

    // Handle text segments
    let remainingText = segment;
    while (remainingText.length > 0) {
      let chunkLength = Math.min(remainingText.length, MAX_CHUNK_LENGTH);
      
      // Find a natural break point
      if (chunkLength < remainingText.length) {
        const lastPeriod = remainingText.lastIndexOf('.', chunkLength);
        const lastComma = remainingText.lastIndexOf(',', chunkLength);
        const breakPoint = Math.max(
          lastPeriod !== -1 ? lastPeriod + 1 : -1,
          lastComma !== -1 ? lastComma + 1 : -1
        );
        
        if (breakPoint > 0) {
          chunkLength = breakPoint;
        }
      }

      const chunk = remainingText.slice(0, chunkLength).trim();
      if (chunk) {
        blocks.push({ text: chunk, pause: 0 });
      }

      remainingText = remainingText.slice(chunkLength).trim();
    }
  }

  return blocks;
}

/**
 * POST /api/tts/generate-audio
 * Body: { script: string, voice?: string, model?: string }
 * 1) parse placeholders
 * 2) TTS each text block
 * 3) add silent segments for pause placeholders
 * 4) merge all into single MP3
 */
router.post('/generate-audio', async (req, res) => {
  try {
    const { script, voice = 'alloy', model = 'tts-1' } = req.body;
    if (!script) {
      return res.status(400).json({ error: 'No script provided' });
    }

    const blocks = parsePlaceholders(script);
    const chunkFiles = [];
    
    // Process each block sequentially
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      try {
        if (block.text) {
          console.log(`Processing text chunk ${i}:`, block.text.slice(0, 50) + '...');
          const mp3Response = await openai.audio.speech.create({
            model,
            voice,
            input: block.text,
          });
          const buffer = Buffer.from(await mp3Response.arrayBuffer());
          const outFile = `chunk-${Date.now()}-${i}.mp3`;
          const outPath = path.join(tempDir, outFile);
          await fs.promises.writeFile(outPath, buffer);
          chunkFiles.push(outPath);
        }
        
        if (block.pause > 0) {
          console.log(`Generating silence for ${block.pause}s`);
          const silenceFile = path.join(tempDir, `silence-${Date.now()}-${i}.mp3`);
          await generateSilence(block.pause, silenceFile);
          chunkFiles.push(silenceFile);
        }
      } catch (error) {
        console.error(`Error processing chunk ${i}:`, error);
        // Clean up any files created so far
        for (const file of chunkFiles) {
          if (fs.existsSync(file)) {
            fs.unlinkSync(file);
          }
        }
        throw error;
      }
    }

    if (chunkFiles.length === 0) {
      throw new Error('No audio chunks were generated');
    }

    console.log(`Merging ${chunkFiles.length} audio files...`);
    const finalFileName = `meditation-${Date.now()}.mp3`;
    const finalPath = path.join(audioDir, finalFileName);

    // Ensure audio directory exists
    await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });

    await mergeChunks(chunkFiles, finalPath);
    console.log('Merge complete');

    // Cleanup temp files
    for (const file of chunkFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }

    const audioUrl = `/audio/${finalFileName}`;
    return res.json({ audioUrl });
  } catch (error) {
    console.error('Error generating TTS audio:', error);
    return res.status(500).json({ 
      error: 'Failed to generate audio.',
      details: error.message 
    });
  }
});

/**
 * Helper to merge an array of MP3 files in sequence using FFmpeg.
 */
async function mergeChunks(files, outputPath) {
  if (files.length === 0) {
    throw new Error('No files to merge');
  }

  // If there's only one file, just copy it
  if (files.length === 1) {
    await fs.promises.copyFile(files[0], outputPath);
    return;
  }

  // Create a temporary file list for concat
  const listPath = path.join(tempDir, `list-${Date.now()}.txt`);
  const fileContent = files.map(f => `file '${f}'`).join('\n');
  await fs.promises.writeFile(listPath, fileContent);

  try {
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions([
          '-c:a', 'libmp3lame',
          '-b:a', '192k',
          '-ar', '44100',
          '-ac', '2'
        ])
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });
  } finally {
    // Clean up the temporary list file
    if (fs.existsSync(listPath)) {
      fs.unlinkSync(listPath);
    }
  }
}

/**
 * POST /api/tts/mix-with-music
 * Body: { ttsUrl: string, musicUrl: string, volume: number }
 * merges final TTS file with background music
 */
router.post('/mix-with-music', (req, res) => {
  const { ttsUrl, musicUrl, volume = 0.3 } = req.body;
  if (!ttsUrl || !musicUrl) {
    return res.status(400).json({ error: 'Missing ttsUrl or musicUrl' });
  }

  const ttsPath = path.join(__dirname, '../public', ttsUrl);
  const musicPath = path.join(__dirname, '../public', musicUrl);

  if (!fs.existsSync(ttsPath) || !fs.existsSync(musicPath)) {
    return res.status(404).json({ error: 'Audio file not found' });
  }

  const outputFileName = `merged-${Date.now()}.mp3`;
  const outputPath = path.join(__dirname, '../public/audio', outputFileName);

  // First, get the duration of the TTS file
  ffmpeg.ffprobe(ttsPath, (err, metadata) => {
    if (err) {
      console.error('Error getting TTS duration:', err);
      return res.status(500).json({ error: 'Failed to process audio' });
    }

    const ttsDuration = metadata.format.duration;

    ffmpeg()
      .input(ttsPath)
      .input(musicPath)
      .complexFilter([
        // Trim music to match TTS length and adjust volume
        `[1:a]atrim=0:${ttsDuration},aloop=0:${Math.ceil(ttsDuration)},volume=${volume}[music]`,
        // Mix TTS with music
        `[0:a][music]amix=inputs=2:duration=first[out]`
      ])
      .outputOptions('-map [out]')
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .on('end', () => {
        const mergedUrl = `/audio/${outputFileName}`;
        return res.json({ mixedAudioUrl: mergedUrl });
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        return res.status(500).json({ error: 'FFmpeg processing failed' });
      })
      .saveToFile(outputPath);
  });
});

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
