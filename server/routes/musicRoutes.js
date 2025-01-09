// server/routes/musicRoutes.js
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Music from '../models/Music.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize default music from public/music folder
const initializeDefaultMusic = async () => {
  const musicDir = path.join(__dirname, '../public/music');
  
  // Create music directory if it doesn't exist
  if (!fs.existsSync(musicDir)) {
    fs.mkdirSync(musicDir, { recursive: true });
    return;
  }

  try {
    // Read all files from the music directory
    const files = fs.readdirSync(musicDir);
    
    for (const file of files) {
      // Check if this music file is already in the database
      const existingMusic = await Music.findOne({ 
        name: file,
        isDefault: true 
      });

      if (!existingMusic) {
        // Add new default music to database
        await Music.create({
          name: file,
          url: `/music/${file}`,
          isDefault: true,
          userId: 'default'
        });
      }
    }
  } catch (error) {
    console.error('Error initializing default music:', error);
  }
};

// Call this when the server starts
initializeDefaultMusic();

// Get all music (both default and user-specific)
router.get('/', requireAuth, async (req, res) => {
  try {
    // Get default music
    const defaultMusic = await Music.find({ isDefault: true });
    
    // Get user's music
    const userMusic = await Music.find({ 
      userId: req.user.id,
      isDefault: false 
    });

    // Combine both lists
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

// Delete music (only user's own music)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const music = await Music.findOne({ 
      _id: req.params.id,
      userId: req.user.id,
      isDefault: false
    });

    if (!music) {
      return res.status(404).json({ 
        error: 'Music not found or you do not have permission to delete it' 
      });
    }

    // Delete the file
    const filePath = path.join(__dirname, '../public', music.url);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await music.deleteOne();
    res.json({ message: 'Music deleted successfully' });
  } catch (error) {
    console.error('Error deleting music:', error);
    res.status(500).json({ error: 'Failed to delete music' });
  }
});

export default router;

