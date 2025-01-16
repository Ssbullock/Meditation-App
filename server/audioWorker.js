import { parentPort } from 'worker_threads';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const tempDir = path.join(__dirname, 'temp');

async function generateTTSForBlock(block, voice, model) {
  try {
    if (!block.text && block.pause > 0) {
      // Handle silence blocks
      return null;
    }

    if (!block.text) return null;

    const mp3Response = await openai.audio.speech.create({
      model,
      voice,
      input: block.text,
    });

    if (!mp3Response) {
      throw new Error('No response from OpenAI TTS API');
    }

    const buffer = Buffer.from(await mp3Response.arrayBuffer());
    const outFile = `worker-chunk-${Date.now()}-${Math.random().toString(36).substring(7)}.mp3`;
    const outPath = path.join(tempDir, outFile);
    await fs.promises.writeFile(outPath, buffer);
    
    return outPath;
  } catch (error) {
    console.error('Worker error generating TTS:', error);
    return null;
  }
}

// Listen for messages from the main thread
parentPort.on('message', async ({ batch }) => {
  try {
    const results = await Promise.all(
      batch.map(block => generateTTSForBlock(block, 'alloy', 'tts-1'))
    );
    
    parentPort.postMessage(results);
  } catch (error) {
    console.error('Worker error:', error);
    parentPort.postMessage([]);
  }
}); 