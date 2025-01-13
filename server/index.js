// server/index.js (ESM style)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import mongoose from 'mongoose';
import User from './models/User.js';

import meditationRoutes from './routes/meditationRoutes.js';
import ttsRoutes from './routes/ttsRoutes.js';
// (Optional) musicRoutes if you allow uploading background tracks
import musicRoutes from './routes/musicRoutes.js';
import fileUpload from 'express-fileupload';
import MongoStore from 'connect-mongo';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// Serve static files with proper headers
const serveStaticWithHeaders = (directory) => {
  return express.static(directory, {
    setHeaders: (res, path) => {
      res.set({
        'Accept-Ranges': 'bytes',
        'Content-Type': 'audio/mpeg'
      });
    }
  });
};

app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://custom-meditations.netlify.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges']
}));

// Static files CORS configuration
app.use('/music', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://custom-meditations.netlify.app');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Range');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  next();
}, serveStaticWithHeaders(path.join(__dirname, 'public/music')));

app.use('/audio', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://custom-meditations.netlify.app');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Range');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  next();
}, serveStaticWithHeaders(path.join(__dirname, 'public/audio')));

app.use('/user-music', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://custom-meditations.netlify.app');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Range');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  next();
}, serveStaticWithHeaders(path.join(__dirname, 'public/user-music')));

// Create necessary directories
const dirs = [
  path.join(__dirname, 'public'),
  path.join(__dirname, 'public/music'),
  path.join(__dirname, 'public/audio'),
  path.join(__dirname, 'public/user-music'),
  path.join(__dirname, 'temp')
];

dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  } else {
    console.log(`Directory exists: ${dir}`);
  }
});

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 24 * 60 * 60 // Session TTL in seconds
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "https://meditation-app-6wyw.onrender.com/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ googleId: profile.id });
    
    if (!user) {
      user = await User.create({
        googleId: profile.id,
        email: profile.emails[0].value,
        name: profile.displayName,
        picture: profile.photos[0].value
      });
    }
    
    return done(null, user);
  } catch (error) {
    return done(error, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Add this after your other middleware
app.use(fileUpload({
  createParentPath: true,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max file size
  }
}));

// Routes
app.use('/api/meditations', meditationRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/music', musicRoutes); // if you have a route for uploading music

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Successfully connected to MongoDB Atlas'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit if we can't connect to the database
  });

// Add this to handle MongoDB connection events
mongoose.connection.on('connected', () => {
  console.log('MongoDB connection established successfully');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB connection disconnected');
});

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  process.exit(0);
});

// Add auth routes to your app
import authRoutes from './routes/authRoutes.js';
app.use('/auth', authRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
