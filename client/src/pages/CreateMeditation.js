// client/src/pages/CreateMeditation.js
import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import '../styles/animations.css';
import { useNavigate } from 'react-router-dom';

const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const AVAILABLE_STYLES = [
  'Mindfulness',
  'Body scan',
  'Nature-based visualization',
  'Breathwork',
  'Affirmations',
  'Self-compassion',
  'Healing light',
];

const STYLE_DESCRIPTIONS = {
  'Mindfulness': 'Focus on present-moment awareness, observing thoughts and sensations without judgment.',
  'Body scan': 'Systematically bring attention to different parts of your body, releasing tension and promoting relaxation.',
  'Nature-based visualization': 'Guided imagery using natural settings to promote peace and tranquility.',
  'Breathwork': 'Specific breathing techniques to calm the mind and regulate the nervous system.',
  'Affirmations': 'Positive statements to promote self-acceptance and personal growth.',
  'Self-compassion': 'Practices to develop kindness and understanding toward yourself.',
  'Healing light': 'Visualization using light imagery for healing and rejuvenation.',
};

function CreateMeditation() {
  // FORM inputs
  const [duration, setDuration] = useState(10);
  const [selectedStyles, setSelectedStyles] = useState([]);
  const [goals, setGoals] = useState('');

  // Script from AI
  const [generatedScript, setGeneratedScript] = useState('');

  // TTS & Merged audio URLs
  const [ttsAudioUrl, setTtsAudioUrl] = useState('');
  const [mergedAudioUrl, setMergedAudioUrl] = useState('');

  // Voice selection
  const [selectedVoice, setSelectedVoice] = useState('alloy');

  // Music
  const [musicOptions, setMusicOptions] = useState([]);
  const [selectedMusic, setSelectedMusic] = useState('');

  // Volumes
  const [ttsVolume, setTtsVolume] = useState(1);
  const [musicVolume, setMusicVolume] = useState(0.3);
  const ttsRef = useRef(null);
  const musicRef = useRef(null);

  // Loading states
  const [loadingScript, setLoadingScript] = useState(false);
  const [loadingTTS, setLoadingTTS] = useState(false);
  const [loadingMerge, setLoadingMerge] = useState(false);
  const [uploadingMusic, setUploadingMusic] = useState(false);

  // Add this state for handling hover
  const [hoveredStyle, setHoveredStyle] = useState(null);

  const [generationTime, setGenerationTime] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [ttsGenerationTime, setTtsGenerationTime] = useState(null);
  const [generatingTTS, setGeneratingTTS] = useState(false);

  // Add new state variables for merge timing
  const [mergeTime, setMergeTime] = useState(null);
  const [isMerging, setIsMerging] = useState(false);

  const navigate = useNavigate();

  // Fetch music list on mount
  useEffect(() => {
    fetchMusicList();
  }, []);

  // Real-time volume
  useEffect(() => {
    if (ttsRef.current) {
      ttsRef.current.volume = ttsVolume;
    }
  }, [ttsVolume]);
  useEffect(() => {
    if (musicRef.current) {
      musicRef.current.volume = musicVolume;
    }
  }, [musicVolume]);

  const fetchMusicList = async () => {
    try {
      const res = await api.get('/api/music');
      console.log('Fetched music options:', res.data);
      setMusicOptions(res.data);
    } catch (error) {
      console.error('Error fetching music:', error.response?.data || error.message);
      alert('Failed to fetch music list');
    }
  };

  // Toggle style selection
  const handleStyleToggle = (style) => {
    setSelectedStyles((prev) => {
      if (prev.includes(style)) {
        return prev.filter((s) => s !== style);
      } else {
        return [...prev, style];
      }
    });
  };

  // 1) Generate script
  const handleGenerateScript = async () => {
    try {
      setIsGenerating(true);
      setGenerationTime(0);
      const startTime = Date.now();
      
      // Start timer update interval
      const timerInterval = setInterval(() => {
        setGenerationTime(Math.round((Date.now() - startTime) / 100) / 10);
      }, 100);

      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/meditations/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          duration: parseInt(duration),
          style: selectedStyles.join(', '),
          extraNotes: `User's goals: ${goals}`
        }),
      });

      clearInterval(timerInterval);
      const endTime = Date.now();
      setGenerationTime(Math.round((endTime - startTime) / 100) / 10);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || 'Failed to generate script');
      }

      const data = await response.json();
      setGeneratedScript(data.script);
      setLoadingScript(false);
    } catch (error) {
      console.error('Error generating script:', error);
      alert(error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // 2) Generate TTS with placeholders => final single MP3
  const handleGenerateTTS = async () => {
    if (!generatedScript) {
      alert('No script found. Please generate a script first.');
      return;
    }
    setLoadingTTS(true);
    setGeneratingTTS(true);
    setTtsGenerationTime(0);
    
    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      setTtsGenerationTime(Math.round((Date.now() - startTime) / 100) / 10);
    }, 100);

    try {
      const res = await api.post('/api/tts/generate-audio', {
        text: generatedScript,
        voice: selectedVoice
      });

      clearInterval(timerInterval);
      
      if (!res.data || !res.data.audioUrl) {
        throw new Error('Invalid response from TTS service');
      }

      setTtsAudioUrl(res.data.audioUrl);
      setTtsGenerationTime(res.data.generationTime || Math.round((Date.now() - startTime) / 100) / 10);
      console.log('TTS generation successful');
    } catch (error) {
      clearInterval(timerInterval);
      console.error('Error generating TTS:', error);
      const errorMessage = error.response?.data?.details || error.message || 'Failed to generate audio';
      alert(`Error generating audio: ${errorMessage}`);
    } finally {
      setLoadingTTS(false);
      setGeneratingTTS(false);
    }
  };

  // 3) Merge TTS + selected music
  const handleMergeWithMusic = async () => {
    if (!ttsAudioUrl || !selectedMusic) {
      alert('Please generate TTS audio and select a music track first');
      return;
    }
    setLoadingMerge(true);
    setIsMerging(true);
    setMergeTime(0);
    
    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      setMergeTime(Math.round((Date.now() - startTime) / 100) / 10);
    }, 100);

    try {
      const res = await api.post('/api/tts/mix-with-music', {
        ttsUrl: ttsAudioUrl,
        musicUrl: selectedMusic,
        musicVolume: parseFloat(musicVolume),
        ttsVolume: parseFloat(ttsVolume)
      });
      
      clearInterval(timerInterval);
      
      if (!res.data || !res.data.mixedAudioUrl) {
        throw new Error('Invalid response from merge service');
      }
      
      setMergedAudioUrl(res.data.mixedAudioUrl);
      setMergeTime(res.data.mergeTime || Math.round((Date.now() - startTime) / 100) / 10);
    } catch (error) {
      clearInterval(timerInterval);
      console.error('Error mixing audio:', error);
      alert('Failed to merge audio: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoadingMerge(false);
      setIsMerging(false);
    }
  };

  // 4) Save the final meditation
  const handleSaveMeditation = async () => {
    // Validate required fields
    if (!goals) {
      alert('Please enter your meditation goals');
      return;
    }
    if (selectedStyles.length === 0) {
      alert('Please select at least one meditation style');
      return;
    }
    if (!duration) {
      alert('Please set a duration');
      return;
    }
    if (!generatedScript) {
      alert('Please generate a meditation script');
      return;
    }
    if (!mergedAudioUrl && !ttsAudioUrl) {
      alert('Please generate audio for your meditation');
      return;
    }

    try {
      const response = await api.post('/api/meditations/save', {
        title: `Meditation (${new Date().toLocaleDateString()})`,
        goals: goals,
        styles: selectedStyles,
        duration: parseInt(duration),
        script: generatedScript,
        audioUrl: mergedAudioUrl || ttsAudioUrl
      });

      if (response.data && response.data.meditation) {
        navigate('/dashboard');
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error) {
      console.error('Error saving meditation:', error);
      alert('Failed to save meditation: ' + (error.response?.data?.details || error.message));
    }
  };

  // Add this new function
  const handleMusicUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    console.log('Uploading music file:', file.name);
    setUploadingMusic(true);
    const formData = new FormData();
    formData.append('music', file);
    formData.append('name', file.name);

    try {
      const response = await api.post('/api/music/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      console.log('Upload successful:', response.data);
      await fetchMusicList();
      event.target.value = '';
    } catch (error) {
      console.error('Error uploading music:', error.response?.data || error.message);
      alert('Failed to upload music file: ' + (error.response?.data?.error || error.message));
    } finally {
      setUploadingMusic(false);
    }
  };

  const handleAudioError = (error) => {
    console.error('Audio playback error:', error);
    // Attempt to reload the audio
    const audioElement = error.target;
    if (audioElement) {
      audioElement.load();
      // Add a small delay before trying to play again
      setTimeout(() => {
        audioElement.play().catch(e => 
          console.error('Retry playback failed:', e)
        );
      }, 1000);
    }
  };

  return (
    <div style={styles.pageBackground}>
      <div style={styles.container}>
        <h1 style={styles.header}>Create Custom Meditation</h1>

        {/* Duration */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Duration (minutes)</h2>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            style={styles.input}
            placeholder="Enter duration in minutes"
          />
        </div>

        {/* Goals */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Goals</h2>
          <textarea
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            style={styles.textArea}
            placeholder="E.g. stress relief, better sleep..."
          />
        </div>

        {/* Styles */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Select Style(s):</h2>
          <div style={styles.buttonRow}>
            {AVAILABLE_STYLES.map((style) => {
              const isSelected = selectedStyles.includes(style);
              const isHovered = hoveredStyle === style;
              return (
                <div 
                  key={style}
                  style={styles.buttonContainer}
                  onMouseEnter={() => setHoveredStyle(style)}
                  onMouseLeave={() => setHoveredStyle(null)}
                >
                  <button
                    onClick={() => handleStyleToggle(style)}
                    style={{
                      ...styles.toggleButton,
                      backgroundColor: isSelected ? '#667eea' : '#f0f0f0',
                      color: isSelected ? '#fff' : '#2c3e50',
                      transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                      boxShadow: isHovered ? '0 4px 8px rgba(0, 0, 0, 0.1)' : 'none',
                    }}
                  >
                    {style}
                  </button>
                  <div style={{
                    ...styles.tooltip,
                    opacity: isHovered ? 1 : 0,
                    visibility: isHovered ? 'visible' : 'hidden',
                  }}>
                    {STYLE_DESCRIPTIONS[style]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Generate Script Button */}
        <div style={styles.section}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button 
              style={{
                ...styles.mainButton,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '150px',
                height: '40px',
              }} 
              onClick={handleGenerateScript} 
              disabled={isGenerating || !selectedStyles.length || !goals.length}
            >
              {isGenerating ? 'Generating...' : 'Generate Script'}
            </button>
            {(isGenerating || generationTime !== null) && (
              <span style={{ 
                color: '#4a5568',
                fontSize: '0.9rem',
                fontFamily: 'monospace'
              }}>
                {isGenerating ? `${generationTime}s...` : `Generated in ${generationTime}s`}
              </span>
            )}
          </div>
        </div>

        {/* Script + Voice + Generate TTS */}
        {generatedScript && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>AI-Generated Script</h3>
            <textarea
              rows={8}
              value={generatedScript}
              onChange={(e) => setGeneratedScript(e.target.value)}
              style={styles.textArea}
            />
            
            <div style={styles.voiceSection}>
              <label style={styles.sectionTitle}>Select TTS Voice:</label>
              <div style={styles.buttonRow}>
                {VOICES.map((voice) => (
                  <button
                    key={voice}
                    onClick={() => setSelectedVoice(voice)}
                    style={{
                      ...styles.toggleButton,
                      backgroundColor: selectedVoice === voice ? '#667eea' : '#f0f0f0',
                      color: selectedVoice === voice ? '#fff' : '#2c3e50',
                    }}
                  >
                    {voice}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button 
                style={{
                  ...styles.mainButton,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }} 
                onClick={handleGenerateTTS} 
                disabled={loadingTTS}
              >
                {loadingTTS ? (
                  <div style={styles.spinner} />
                ) : (
                  'Generate TTS Audio'
                )}
              </button>
              {(generatingTTS || ttsGenerationTime !== null) && (
                <span style={{ 
                  color: '#4a5568',
                  fontSize: '0.9rem',
                  fontFamily: 'monospace'
                }}>
                  {generatingTTS ? `${ttsGenerationTime}s...` : `Generated in ${ttsGenerationTime}s`}
                </span>
              )}
            </div>
          </div>
        )}

        {/* TTS Audio + Music Dropdown */}
        {ttsAudioUrl && !mergedAudioUrl && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Preview TTS Audio</h3>
            <div style={styles.audioPlayer}>
              <h4>Generated Speech</h4>
              <audio
                ref={ttsRef}
                controls
                src={`${process.env.REACT_APP_API_URL}/api/tts${ttsAudioUrl}`}
                onError={(e) => {
                  console.error('TTS Audio playback error:', e);
                  // Retry loading with full URL if relative URL fails
                  if (!e.target.src.startsWith('http')) {
                    e.target.src = `${process.env.REACT_APP_API_URL}/api/tts${ttsAudioUrl}`;
                  }
                }}
              />
            </div>
            <label style={styles.sectionTitle}>TTS Volume</label>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={ttsVolume}
              onChange={(e) => setTtsVolume(e.target.value)}
            />

            <h3 style={styles.sectionTitle}>Select Background Music</h3>
            <div style={styles.musicControls}>
              <select
                value={selectedMusic}
                onChange={(e) => setSelectedMusic(e.target.value)}
                style={styles.select}
              >
                <option value="">-- No music --</option>
                {musicOptions.map((file) => (
                  <option key={file.url} value={file.url}>
                    {file.name}
                  </option>
                ))}
              </select>
              
              <button
                style={styles.uploadButton}
                onClick={() => document.getElementById('musicUpload').click()}
              >
                Upload Music
              </button>
              <input
                id="musicUpload"
                type="file"
                accept="audio/*"
                onChange={handleMusicUpload}
                style={{ display: 'none' }}
              />
              {uploadingMusic && <div style={styles.loadingBar}>Uploading music...</div>}
              
              {selectedMusic && !musicOptions.find(m => m.url === selectedMusic)?.isDefault && (
                <button
                  style={styles.deleteButton}
                  onClick={async () => {
                    try {
                      const musicId = musicOptions.find(m => m.url === selectedMusic)?._id;
                      if (musicId) {
                        await api.delete(`/api/music/${musicId}`);
                        setSelectedMusic('');
                        fetchMusicList();
                      }
                    } catch (error) {
                      console.error('Error deleting music:', error);
                      alert('Failed to delete music file');
                    }
                  }}
                >
                  Delete Music
                </button>
              )}
            </div>

            {selectedMusic && (
              <div style={{
                ...styles.section,
                marginTop: '2rem',
              }}>
                <h4 style={styles.sectionTitle}>Music Preview</h4>
                <div style={styles.audioPlayer}>
                  <h4>Selected Music</h4>
                  <audio
                    ref={musicRef}
                    controls
                    src={`${process.env.REACT_APP_API_URL}${selectedMusic}`}
                    onError={(e) => {
                      console.error('Music playback error:', e);
                      // Retry loading with full URL if relative URL fails
                      if (!e.target.src.startsWith('http')) {
                        e.target.src = `${process.env.REACT_APP_API_URL}${selectedMusic}`;
                      }
                    }}
                  />
                </div>
                <label style={styles.sectionTitle}>Music Volume</label>
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={musicVolume}
                  onChange={(e) => setMusicVolume(e.target.value)}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <button 
                    style={{
                      ...styles.mainButton,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }} 
                    onClick={handleMergeWithMusic} 
                    disabled={loadingMerge}
                  >
                    {loadingMerge ? (
                      <div style={styles.spinner} />
                    ) : (
                      'Merge with Music'
                    )}
                  </button>
                  {(isMerging || mergeTime !== null) && (
                    <span style={{ 
                      color: '#4a5568',
                      fontSize: '0.9rem',
                      fontFamily: 'monospace'
                    }}>
                      {isMerging ? `${mergeTime}s...` : `Merged in ${mergeTime}s`}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Merged Audio */}
        {mergedAudioUrl && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Final Merged Meditation Audio</h3>
            <div style={styles.audioPlayer}>
              <h4>Final Mixed Audio</h4>
              <audio
                controls
                src={`${process.env.REACT_APP_API_URL}/api/tts${mergedAudioUrl}`}
                onError={(e) => {
                  console.error('Merged Audio playback error:', e);
                  // Retry loading with full URL if relative URL fails
                  if (!e.target.src.startsWith('http')) {
                    e.target.src = `${process.env.REACT_APP_API_URL}/api/tts${mergedAudioUrl}`;
                  }
                }}
              />
            </div>
          </div>
        )}

        {/* Save Button */}
        {(ttsAudioUrl || mergedAudioUrl) && (
          <button style={styles.saveButton} onClick={handleSaveMeditation}>
            Save Meditation
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '1000px',
    margin: '0 auto',
    padding: '2rem',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: '12px',
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.15)',
    marginTop: '2rem',
    marginBottom: '2rem',
    backdropFilter: 'blur(10px)',
    '@media (max-width: 768px)': {
      padding: '1rem',
      margin: '1rem',
      borderRadius: '8px',
    }
  },
  pageBackground: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    minHeight: '100vh',
    padding: '2rem',
  },
  header: {
    textAlign: 'center',
    marginBottom: '2rem',
    color: '#2c3e50',
    fontSize: '2rem',
    fontWeight: '600',
  },
  section: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: '1.5rem',
    borderRadius: '12px',
    marginBottom: '1.5rem',
    border: '1px solid rgba(0, 0, 0, 0.1)',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
    '@media (max-width: 768px)': {
      padding: '1rem',
      borderRadius: '8px',
    }
  },
  sectionTitle: {
    color: '#2c3e50',
    marginBottom: '1rem',
    fontSize: '1.2rem',
    fontWeight: '500',
  },
  input: {
    width: 'calc(100% - 1.6rem)',
    padding: '0.8rem',
    borderRadius: '8px',
    border: '1px solid #ced4da',
    fontSize: '1rem',
    outline: 'none',
    transition: 'all 0.2s ease-in-out',
    '&:focus': {
      borderColor: '#667eea',
      boxShadow: '0 0 0 3px rgba(102, 126, 234, 0.25)',
    },
  },
  textArea: {
    width: 'calc(100% - 1.6rem)',
    padding: '0.8rem',
    borderRadius: '8px',
    border: '1px solid #ced4da',
    fontSize: '1rem',
    minHeight: '100px',
    outline: 'none',
    transition: 'all 0.2s ease-in-out',
    resize: 'vertical',
    '&:focus': {
      borderColor: '#667eea',
      boxShadow: '0 0 0 3px rgba(102, 126, 234, 0.25)',
    },
  },
  buttonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.8rem',
    marginTop: '1rem',
    marginBottom: '1.5rem',
    '@media (max-width: 768px)': {
      gap: '0.5rem',
    }
  },
  toggleButton: {
    border: 'none',
    borderRadius: '8px',
    padding: '0.8rem 1.2rem',
    cursor: 'pointer',
    transition: 'all 0.2s ease-in-out',
    fontSize: '0.9rem',
    fontWeight: '500',
    backgroundColor: '#f0f0f0',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
    },
    '@media (max-width: 768px)': {
      padding: '0.6rem 1rem',
      fontSize: '0.8rem',
      flex: '1 0 calc(50% - 0.5rem)', // Two buttons per row on mobile
    }
  },
  mainButton: {
    backgroundColor: '#667eea',
    color: '#fff',
    border: 'none',
    padding: '0.8rem 1.5rem',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500',
    transition: 'all 0.2s ease-in-out',
    marginTop: '1rem',
    '&:hover': {
      backgroundColor: '#764ba2',
      transform: 'translateY(-2px)',
      boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)',
    },
  },
  secondaryButton: {
    backgroundColor: '#6c757d',
    color: '#fff',
    border: 'none',
    padding: '0.8rem 1.5rem',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500',
    transition: 'background-color 0.2s',
    '&:hover': {
      backgroundColor: '#5a6268',
    },
  },
  saveButton: {
    backgroundColor: '#667eea',
    color: '#fff',
    border: 'none',
    padding: '0.8rem 1.5rem',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500',
    transition: 'all 0.2s ease-in-out',
    width: '100%',
    marginTop: '1rem',
    '&:hover': {
      backgroundColor: '#764ba2',
      transform: 'translateY(-2px)',
      boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)',
    }
  },
  select: {
    padding: '0.8rem',
    borderRadius: '6px',
    border: '1px solid #ced4da',
    fontSize: '1rem',
    minWidth: '200px',
    outline: 'none',
    backgroundColor: '#fff',
    '@media (max-width: 768px)': {
      width: '100%',
    }
  },
  loadingBar: {
    marginTop: '0.8rem',
    color: '#007BFF',
    fontWeight: '500',
    textAlign: 'center',
  },
  musicControls: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'center',
    marginTop: '1rem',
    marginBottom: '1rem',
    flexWrap: 'wrap',
    padding: '1rem',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: '8px',
    '@media (max-width: 768px)': {
      flexDirection: 'column',
      gap: '0.5rem',
    }
  },
  audioPlayer: {
    width: '100%',
    marginTop: '1rem',
  },
  volumeControl: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    marginTop: '1rem',
    width: '100%',
  },
  volumeSlider: {
    width: '80%',
    height: '4px',
    WebkitAppearance: 'none',
    appearance: 'none',
    background: '#e0e0e0',
    outline: 'none',
    borderRadius: '2px',
    margin: '1rem 0',
    '&::-webkit-slider-thumb': {
      WebkitAppearance: 'none',
      appearance: 'none',
      width: '16px',
      height: '16px',
      background: '#667eea',
      cursor: 'pointer',
      borderRadius: '50%',
      transition: 'all 0.2s ease',
    },
    '&::-webkit-slider-thumb:hover': {
      transform: 'scale(1.2)',
      background: '#764ba2',
    }
  },
  tooltip: {
    position: 'absolute',
    bottom: '120%',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(44, 62, 80, 0.95)',
    color: 'white',
    padding: '1rem',
    borderRadius: '8px',
    fontSize: '0.9rem',
    width: '220px',
    textAlign: 'center',
    marginBottom: '12px',
    zIndex: 1000,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
    backdropFilter: 'blur(5px)',
    transition: 'all 0.2s ease-in-out',
    opacity: 0,
    visibility: 'hidden',
    '&.visible': {
      opacity: 1,
      visibility: 'visible',
    },
  },
  voiceSection: {
    marginTop: '2rem',
    '@media (max-width: 768px)': {
      marginTop: '1rem',
    }
  },
  buttonContainer: {
    position: 'relative',
    display: 'inline-block',
  },
  spinner: {
    display: 'inline-block',
    width: '20px',
    height: '20px',
    border: '3px solid rgba(255,255,255,.3)',
    borderRadius: '50%',
    borderTopColor: '#fff',
    animation: 'spin 1s linear infinite',
    marginLeft: '0',
  },
  uploadButton: {
    backgroundColor: '#667eea',
    color: '#fff',
    border: 'none',
    padding: '0.8rem 1.5rem',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500',
    transition: 'all 0.2s ease-in-out',
    '&:hover': {
      backgroundColor: '#764ba2',
      transform: 'translateY(-2px)',
      boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)',
    }
  },
  mergeButtonContainer: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
    marginTop: '2rem',
  },
  deleteButton: {
    backgroundColor: '#dc3545',
    color: '#fff',
    border: 'none',
    padding: '0.8rem 1.5rem',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500',
    transition: 'all 0.2s ease-in-out',
    '&:hover': {
      backgroundColor: '#c82333',
      transform: 'translateY(-2px)',
      boxShadow: '0 4px 12px rgba(220, 53, 69, 0.3)',
    }
  },
};

// Add CSS for mobile-specific audio player styling
const audioPlayerStyles = `
  @media (max-width: 768px) {
    audio {
      width: 100%;
      height: 40px;
    }
    
    audio::-webkit-media-controls-panel {
      background-color: #f8f9fa;
    }
    
    audio::-webkit-media-controls-current-time-display,
    audio::-webkit-media-controls-time-remaining-display {
      font-size: 12px;
    }
  }
`;

// Add the styles to the document
const styleSheet = document.createElement("style");
styleSheet.innerText = audioPlayerStyles;
document.head.appendChild(styleSheet);

export default CreateMeditation;
