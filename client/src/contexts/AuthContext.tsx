import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

interface User {
  id: string;
  email: string;
  name?: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (identityToken: string, authorizationCode: string, userData?: any) => Promise<void>;
  logout: () => void;
  verifyToken: (token: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      verifyToken(token);
    } else {
      setLoading(false);
    }
  }, []);

  const verifyToken = async (token: string): Promise<boolean> => {
    try {
      const response = await axios.post('/api/auth/verify', { token });
      if (response.data.success) {
        setUser(response.data.data.user);
        setLoading(false);
        return true;
      } else {
        localStorage.removeItem('token');
        setUser(null);
        setLoading(false);
        return false;
      }
    } catch (error) {
      console.error('Token verification failed:', error);
      localStorage.removeItem('token');
      setUser(null);
      setLoading(false);
      return false;
    }
  };

  const login = async (identityToken: string, authorizationCode: string, userData?: any) => {
    try {
      setLoading(true);
      const response = await axios.post('/api/auth/apple', {
        identityToken,
        authorizationCode,
        user: userData,
      });

      if (response.data.success) {
        const { user: userInfo, token } = response.data.data;
        setUser(userInfo);
        localStorage.setItem('token', token);
        
        // Set default authorization header for future requests
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        
        toast.success('Successfully logged in!');
      } else {
        throw new Error(response.data.error || 'Login failed');
      }
    } catch (error: any) {
      console.error('Login error:', error);
      toast.error(error.response?.data?.error || 'Login failed. Please try again.');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('token');
    delete axios.defaults.headers.common['Authorization'];
    toast.success('Successfully logged out!');
  };

  const value: AuthContextType = {
    user,
    loading,
    login,
    logout,
    verifyToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
