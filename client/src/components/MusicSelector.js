import React, { useState, useEffect } from 'react';
import axios from 'axios';

function MusicSelector({ onMusicSelect, selectedMusic }) {
  const [musicList, setMusicList] = useState({ default: [], user: [] });
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMusicList();
  }, []);

  const fetchMusicList = async () => {
    try {
      setLoading(true);
      const response = await axios.get('http://localhost:5001/api/music');
      const defaultMusic = response.data.filter(m => m.isDefault);
      const userMusic = response.data.filter(m => !m.isDefault);
      setMusicList({ default: defaultMusic, user: userMusic });
    } catch (error) {
      console.error('Error fetching music:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMusicUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    setUploadingMusic(true);
    const formData = new FormData();
    formData.append('music', file);
    formData.append('name', file.name);

    try {
      await axios.post('http://localhost:5001/api/music/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      fetchMusicList();
    } catch (error) {
      console.error('Upload error:', error);
      alert('Error uploading music file');
    } finally {
      setUploadingMusic(false);
    }
  };

  if (loading) {
    return <div>Loading music...</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <h3>Default Music</h3>
        <select 
          onChange={(e) => onMusicSelect(e.target.value)}
          value={selectedMusic || ''}
          style={styles.select}
        >
          <option value="">Select Default Music</option>
          {musicList.default.map(music => (
            <option key={music._id} value={music.url}>
              {music.name}
            </option>
          ))}
        </select>
      </div>

      <div style={styles.section}>
        <h3>Your Music</h3>
        <select 
          onChange={(e) => onMusicSelect(e.target.value)}
          value={selectedMusic || ''}
          style={styles.select}
        >
          <option value="">Select Your Music</option>
          {musicList.user.map(music => (
            <option key={music._id} value={music.url}>
              {music.name}
            </option>
          ))}
        </select>
        <input
          type="file"
          accept="audio/*"
          onChange={handleMusicUpload}
          style={styles.fileInput}
        />
        {uploadingMusic && <div>Uploading...</div>}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  select: {
    padding: '0.5rem',
    borderRadius: '4px',
    border: '1px solid #ccc',
  },
  fileInput: {
    marginTop: '0.5rem',
  },
};

export default MusicSelector; 