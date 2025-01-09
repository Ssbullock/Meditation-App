import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  googleId: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  name: String,
  picture: String,
  meditations: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meditation'
  }]
}, {
  timestamps: true
});

export default mongoose.model('User', userSchema); 