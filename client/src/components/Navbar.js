import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import '../styles/Navbar.css';
import logo from '../assets/logo.png';

function Navbar() {
  const { user, login, logout } = useAuth();

  return (
    <nav style={styles.nav}>
      <div style={styles.logoContainer}>
        <img src={logo} alt="Meditation App Logo" style={styles.logo} />
        <div style={styles.links}>
          <Link to="/" className="nav-link">Home</Link>
          {user && (
            <Link to="/create" className="nav-link">Create</Link>
          )}
        </div>
      </div>
      <div style={styles.auth}>
        {user ? (
          <div style={styles.userInfo}>
            <img src={user.picture} alt={user.name} style={styles.avatar} />
            <span style={styles.userName}>{user.name}</span>
            <button onClick={logout} className="nav-button">Logout</button>
          </div>
        ) : (
          <button onClick={login} className="nav-button">Sign in with Google</button>
        )}
      </div>
    </nav>
  );
}

const styles = {
  nav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 2rem',
    backgroundColor: '#ffffff',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  logoContainer: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  logo: {
    height: '70px',
  },
  links: {
    display: 'flex',
    gap: '1rem',
  },
  auth: {
    display: 'flex',
    alignItems: 'center',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  avatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
  },
  userName: {
    fontWeight: '500',
  },
};

export default Navbar;