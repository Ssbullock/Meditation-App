// client/src/pages/Dashboard.js
import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { Link } from 'react-router-dom';
import '../styles/Dashboard.css';
import '../styles/responsive.css';

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

  const handleDeleteMusic = async (musicId) => {
    try {
      await api.delete(`/api/music/${musicId}`);
      // Refresh the music list
      fetchMusicFiles();
    } catch (error) {
      console.error('Error deleting music file:', error);
      alert('Failed to delete music file: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleDeleteMeditation = async (meditationId) => {
    try {
      await api.delete(`/api/meditations/${meditationId}`);
      // Refresh the meditations list
      fetchMeditations();
    } catch (error) {
      console.error('Error deleting meditation:', error);
      alert('Failed to delete meditation: ' + (error.response?.data?.error || error.message));
    }
  };

  // Add intersection observer for lazy loading
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const audio = entry.target;
            audio.preload = "metadata";
            observer.unobserve(audio);
          }
        });
      },
      { rootMargin: '50px' }
    );

    document.querySelectorAll('audio').forEach(audio => {
      observer.observe(audio);
    });

    return () => observer.disconnect();
  }, [savedMeditations]);

  useEffect(() => {
    let touchStart = 0;
    let touchEnd = 0;

    const handleTouchStart = (e) => {
      touchStart = e.targetTouches[0].clientY;
    };

    const handleTouchMove = (e) => {
      touchEnd = e.targetTouches[0].clientY;
    };

    const handleTouchEnd = () => {
      if (touchStart - touchEnd > 150) {
        // Pull down detected
        fetchMeditations();
        fetchMusicFiles();
      }
      touchStart = 0;
      touchEnd = 0;
    };

    const content = document.querySelector('.mobile-padding');
    if (content) {
      content.addEventListener('touchstart', handleTouchStart);
      content.addEventListener('touchmove', handleTouchMove);
      content.addEventListener('touchend', handleTouchEnd);

      return () => {
        content.removeEventListener('touchstart', handleTouchStart);
        content.removeEventListener('touchmove', handleTouchMove);
        content.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, []);

  return (
    <div className="mobile-stack" style={styles.container}>
      <div className="mobile-full-width" style={styles.sidebar}>
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
          <button className="create-button mobile-full-width">
            Create New
          </button>
        </Link>
      </div>

      <div className="mobile-padding" style={styles.content}>
        {selectedTab === 'meditations' && (
          <div>
            <h2 style={styles.contentHeader}>Saved Meditations</h2>
            {savedMeditations.map((med) => (
              <div key={med._id} className="card mobile-card">
                <div style={styles.cardHeader}>
                  <h3 style={styles.cardTitle} className="mobile-compact-text">
                    {med.title || `Meditation (${new Date(med.createdAt).toLocaleDateString()})`}
                  </h3>
                  <button
                    onClick={() => handleDeleteMeditation(med._id)}
                    className="delete-button mobile-small-text"
                  >
                    Delete
                  </button>
                </div>
                <div style={styles.infoText} className="mobile-compact-text">
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
                    preload="none"
                    className="mobile-full-width"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {selectedTab === 'songs' && (
          <div>
            <h2 style={styles.contentHeader}>Music Library</h2>
            {musicFiles.map((music) => (
              <div key={music._id} className="card">
                <div style={styles.cardHeader}>
                  <h3 style={styles.cardTitle}>{music.name}</h3>
                  {!music.isDefault && (
                    <button
                      onClick={() => handleDeleteMusic(music._id)}
                      className="delete-button"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <audio 
                  controls 
                  src={`${process.env.REACT_APP_API_URL}${music.url}`} 
                  preload="metadata"
                  onError={(e) => console.error('Audio error:', e)}
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
    '@media (max-width: 768px)': {
      flexDirection: 'column',
    }
  },
  sidebar: {
    width: '200px',
    backgroundColor: '#ffffff',
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    boxShadow: '2px 0 4px rgba(0, 0, 0, 0.1)',
    '@media (max-width: 768px)': {
      width: '100%',
      padding: '1rem',
      flexDirection: 'row',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 10,
    }
  },
  content: {
    flex: 1,
    padding: '2rem',
    overflowY: 'auto',
    backgroundColor: '#f8f9fa',
    '@media (max-width: 768px)': {
      padding: '1rem',
    }
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
    '@media (max-width: 768px)': {
      width: '100%',
    }
  },
};

export default Dashboard;
