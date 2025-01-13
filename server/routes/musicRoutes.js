// server/routes/musicRoutes.js
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Music from '../models/Music.js';
import { requireAuth } from '../middleware/auth.js';
import mongoose from 'mongoose';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize default music
const initializeDefaultMusic = async () => {
  try {
    // Get all files in the music directory
    const musicFiles = fs.readdirSync(path.join(process.cwd(), 'public/music'));
    console.log('Found default music files:', musicFiles);

    // Mark all existing default music as non-default
    await Music.updateMany({ isDefault: true }, { isDefault: false });

    // Create a system user ID for default music if it doesn't exist
    const systemUserId = '000000000000000000000000'; // 24-character hex string

    // Process each file
    for (const file of musicFiles) {
      const musicPath = `/music/${file}`;
      const existingMusic = await Music.findOne({ url: musicPath });

      if (!existingMusic) {
        console.log('Creating new default music:', file);
        await Music.create({
          name: file.replace(/\.[^/.]+$/, ''), // Remove file extension
          url: musicPath,
          isDefault: true,
          userId: systemUserId // Use system user ID for default music
        });
      } else {
        // Update existing music to be default
        existingMusic.isDefault = true;
        existingMusic.userId = systemUserId;
        await existingMusic.save();
      }
    }

    // Remove any default music that no longer exists in the directory
    const defaultMusic = await Music.find({ isDefault: true });
    for (const music of defaultMusic) {
      const fileName = path.basename(music.url);
      if (!musicFiles.includes(fileName)) {
        await Music.deleteOne({ _id: music._id });
      }
    }

    console.log('Default music initialization complete');
  } catch (error) {
    console.warn('Error initializing default music:', error);
  }
};

// Call initialization on startup
setTimeout(initializeDefaultMusic, 1000); // Wait for DB connection

// Get all music (both default and user-specific)
router.get('/', requireAuth, async (req, res) => {
  try {
    // Get default music
    const defaultMusic = await Music.find({ isDefault: true });
    console.log('Found default music:', defaultMusic.length, 'items');
    
    // Get user's music (non-default music that belongs to the user)
    const userMusic = await Music.find({ 
      userId: req.user.id,
      isDefault: { $ne: true }
    });
    console.log('Found user music:', userMusic.length, 'items');
    
    const allMusic = [...defaultMusic, ...userMusic];
    res.json(allMusic);
  } catch (error) {
    console.error('Error fetching music:', error);
    res.status(500).json({ error: 'Failed to fetch music' });
  }
});

// Upload new music (user-specific)
router.post('/upload', requireAuth, async (req, res) => {
  try {
    if (!req.files || !req.files.music) {
      return res.status(400).json({ error: 'No music file uploaded' });
    }

    const musicFile = req.files.music;
    const fileName = `${Date.now()}-${musicFile.name}`;
    const userMusicDir = path.join(__dirname, '../public/user-music', req.user.id);
    
    // Create user-specific directory if it doesn't exist
    if (!fs.existsSync(userMusicDir)) {
      fs.mkdirSync(userMusicDir, { recursive: true });
    }

    const filePath = path.join(userMusicDir, fileName);

    // Move the file to user's music directory
    await musicFile.mv(filePath);

    // Create new music document
    const music = new Music({
      name: req.body.name || musicFile.name,
      url: `/user-music/${req.user.id}/${fileName}`,
      userId: req.user.id,
      isDefault: false
    });

    await music.save();
    res.json(music);
  } catch (error) {
    console.error('Error uploading music:', error);
    res.status(500).json({ error: 'Failed to upload music' });
  }
});

// Delete music (user-specific only)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const music = await Music.findOne({ 
      _id: req.params.id,
      userId: req.user.id,
      isDefault: false
    });

    if (!music) {
      return res.status(404).json({ error: 'Music not found or not authorized to delete' });
    }

    // Delete the file
    const filePath = path.join(__dirname, '../public', music.url);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (fileError) {
      console.error('Error deleting file:', fileError);
      // Continue with database deletion even if file deletion fails
    }

    // Delete from database
    await Music.deleteOne({ _id: req.params.id });
    res.json({ message: 'Music deleted successfully' });
  } catch (error) {
    console.error('Error deleting music:', error);
    res.status(500).json({ 
      error: 'Failed to delete music',
      details: error.message 
    });
  }
});

export default router;

