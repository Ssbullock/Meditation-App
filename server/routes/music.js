const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/music/') // Changed to public/music directory
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});

const upload = multer({ storage: storage });

router.post('/upload', upload.single('musicFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    // Return the path relative to public directory
    res.json({ url: '/music/' + req.file.filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}); 