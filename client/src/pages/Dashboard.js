// client/src/pages/Dashboard.js
import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Link } from 'react-router-dom';
import '../styles/Dashboard.css';

function Dashboard() {
  const [selectedTab, setSelectedTab] = useState('meditations');
  
  // For meditations
  const [savedMeditations, setSavedMeditations] = useState([]);
  
  // For songs
  const [musicFiles, setMusicFiles] = useState([]);

  useEffect(() => {
    fetchMeditations();
    fetchMusicFiles();
  }, []);

  const fetchMeditations = async () => {
    try {
      const res = await api.get('/api/meditations');
      setSavedMeditations(res.data); // adjust if your route returns an array
    } catch (error) {
      console.error('Error fetching meditations:', error);
    }
  };

  const fetchMusicFiles = async () => {
    try {
      const res = await api.get('/api/music');
      setMusicFiles(res.data); // array of { name, url }
    } catch (error) {
      console.error('Error fetching music files:', error);
    }
  };

  const handleTabClick = (tab) => {
    setSelectedTab(tab);
  };

  const handleDeleteMusic = async (filename) => {
    try {
      await api.delete(`/api/music/${filename}`);
      // Refresh the music list
      fetchMusicFiles();
    } catch (error) {
      console.error('Error deleting music file:', error);
      alert('Failed to delete music file');
    }
  };

  const handleDeleteMeditation = async (id) => {
    try {
      await api.delete(`/api/meditations/${id}`);
      // Refresh the meditations list
      fetchMeditations();
    } catch (error) {
      console.error('Error deleting meditation:', error);
      alert('Failed to delete meditation');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <button
          className={`tab-button ${selectedTab === 'meditations' ? 'active' : ''}`}
          onClick={() => handleTabClick('meditations')}
        >
          Meditations
        </button>
        <button
          className={`tab-button ${selectedTab === 'songs' ? 'active' : ''}`}
          onClick={() => handleTabClick('songs')}
        >
          Songs
        </button>
        <Link to="/create" style={{ textDecoration: 'none' }}>
          <button className="create-button">
            Create New
          </button>
        </Link>
      </div>

      <div style={styles.content}>
        {selectedTab === 'meditations' && (
          <div>
            <h2 style={styles.contentHeader}>Saved Meditations</h2>
            {savedMeditations.map((med) => (
              <div key={med.id} className="card">
                <div style={styles.cardHeader}>
                  <h3 style={styles.cardTitle}>
                    {med.title || `Meditation (${new Date(med.createdAt).toLocaleDateString()})`}
                  </h3>
                  <button
                    onClick={() => handleDeleteMeditation(med.id)}
                    className="delete-button"
                  >
                    Delete
                  </button>
                </div>
                <div style={styles.infoText}>
                  <strong>Goals:</strong> {med.goals}
                </div>
                <div style={styles.infoText}>
                  <strong>Styles:</strong>{' '}
                  {med.styles && med.styles.map(style => (
                    <span key={style} className="tag">{style}</span>
                  ))}
                </div>
                <div style={styles.infoText}>
                  <strong>Duration:</strong> {med.duration} minutes
                </div>
                {med.audioUrl && (
                  <audio
                    controls
                    src={`${process.env.REACT_APP_API_URL}${med.audioUrl}`}
                    style={styles.audioPlayer}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {selectedTab === 'songs' && (
          <div>
            <h2 style={styles.contentHeader}>Background Music</h2>
            {musicFiles.map((file) => (
              <div key={file.url} className="card">
                <div style={styles.cardHeader}>
                  <h3 style={styles.cardTitle}>{file.name}</h3>
                  <button
                    onClick={() => handleDeleteMusic(file.name)}
                    className="delete-button"
                  >
                    Delete
                  </button>
                </div>
                <audio
                  controls
                  src={`${process.env.REACT_APP_API_URL}${file.url}`}
                  style={styles.audioPlayer}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    height: '100vh',
    backgroundColor: '#f5f7fa',
  },
  sidebar: {
    width: '200px',
    backgroundColor: '#ffffff',
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    boxShadow: '2px 0 4px rgba(0, 0, 0, 0.1)',
  },
  content: {
    flex: 1,
    padding: '2rem',
    overflowY: 'auto',
    backgroundColor: '#f8f9fa',
  },
  contentHeader: {
    color: '#2c3e50',
    fontSize: '2rem',
    marginBottom: '1.5rem',
    fontWeight: '600',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
  },
  cardTitle: {
    color: '#2c3e50',
    fontSize: '1.2rem',
    fontWeight: '500',
    margin: 0,
  },
  infoText: {
    color: '#495057',
    marginBottom: '0.8rem',
  },
  audioPlayer: {
    width: '100%',
    marginTop: '1rem',
    borderRadius: '8px',
    backgroundColor: '#f1f3f5',
  },
};

export default Dashboard;
