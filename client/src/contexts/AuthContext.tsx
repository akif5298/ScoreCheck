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
  demoLogin: (userData?: any) => void; // Demo login that bypasses authentication
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
    // COMMENTED OUT FOR DEMO - Skip token verification
    // if (token) {
    //   verifyToken(token);
    // } else {
    //   setLoading(false);
    // }
    // For demo: check if user exists in localStorage
    const demoUser = localStorage.getItem('demoUser');
    if (demoUser) {
      setUser(JSON.parse(demoUser));
    }
    setLoading(false);
  }, []);

  const verifyToken = async (token: string): Promise<boolean> => {
    // COMMENTED OUT FOR DEMO - Skip API verification
    // try {
    //   const response = await axios.post('/api/auth/verify', { token });
    //   if (response.data.success) {
    //     setUser(response.data.data.user);
    //     setLoading(false);
    //     return true;
    //   } else {
    //     localStorage.removeItem('token');
    //     setUser(null);
    //     setLoading(false);
    //     return false;
    //   }
    // } catch (error) {
    //   console.error('Token verification failed:', error);
    //   localStorage.removeItem('token');
    //   setUser(null);
    //   setLoading(false);
    //   return false;
    // }
    // For demo: return true if token exists
    if (token) {
      const demoUser = localStorage.getItem('demoUser');
      if (demoUser) {
        setUser(JSON.parse(demoUser));
        setLoading(false);
        return true;
      }
    }
    setLoading(false);
    return false;
  };

  const login = async (identityToken: string, authorizationCode: string, userData?: any) => {
    // COMMENTED OUT FOR DEMO - Skip API authentication
    // try {
    //   console.log('Starting login process...', { identityToken, authorizationCode, userData });
    //   setLoading(true);
    //   
    //   const response = await axios.post('/api/auth/apple', {
    //     identityToken,
    //     authorizationCode,
    //     user: userData,
    //   });

    //   console.log('Login response:', response.data);

    //   if (response.data.success) {
    //     const { user: userInfo, token } = response.data.data;
    //     console.log('Login successful, setting user:', userInfo);
    //     setUser(userInfo);
    //     localStorage.setItem('token', token);
    //     
    //     // Set default authorization header for future requests
    //     axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    //     
    //     toast.success('Successfully logged in!');
    //   } else {
    //     throw new Error(response.data.error || 'Login failed');
    //   }
    // } catch (error: any) {
    //   console.error('Login error:', error);
    //   console.error('Error response:', error.response?.data);
    //   toast.error(error.response?.data?.error || 'Login failed. Please try again.');
    //   throw error;
    // } finally {
    //   setLoading(false);
    // }
    
    // For demo: Use demo login instead
    demoLogin(userData);
  };

  const demoLogin = (userData?: any) => {
    // Demo login that bypasses authentication
    setLoading(true);
    const mockUser: User = {
      id: 'demo-user-id',
      email: userData?.email || 'demo@scorecheck.com',
      name: userData?.name ? `${userData.name.firstName} ${userData.name.lastName}` : 'Demo User',
      role: 'USER',
      createdAt: new Date().toISOString(),
    };
    const mockToken = 'demo-token-' + Date.now();
    
    setUser(mockUser);
    localStorage.setItem('token', mockToken);
    localStorage.setItem('demoUser', JSON.stringify(mockUser));
    
    // Set default authorization header for future requests
    axios.defaults.headers.common['Authorization'] = `Bearer ${mockToken}`;
    
    setLoading(false);
    toast.success('Successfully logged in! (Demo Mode)');
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
    demoLogin,
    logout,
    verifyToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
