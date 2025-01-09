import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { jwtDecode } from "jwt-decode";

function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    
    if (token) {
      try {
        const decoded = jwtDecode(token);
        localStorage.setItem('token', token);
        setUser(decoded);
        navigate('/dashboard');
      } catch (error) {
        console.error('Invalid token:', error);
        navigate('/login');
      }
    } else {
      navigate('/login');
    }
  }, [navigate, setUser]);

  return (
    <div style={styles.container}>
      <div style={styles.loader}>Authenticating...</div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    background: '#f5f7fa',
  },
  loader: {
    fontSize: '1.2rem',
    color: '#666',
  },
};

export default AuthCallback; 