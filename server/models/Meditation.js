import mongoose from 'mongoose';

const meditationSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  goals: {
    type: String,
    required: true
  },
  styles: [{
    type: String
  }],
  duration: {
    type: Number,
    required: true
  },
  script: {
    type: String,
    required: true
  },
  audioUrl: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('Meditation', meditationSchema); 