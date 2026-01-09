import React, { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Link, useNavigate } from 'react-router-dom';

const Login: React.FC = () => {
  const { login, demoLogin, user } = useAuth();
  const navigate = useNavigate();

  // Redirect if user is already logged in
  useEffect(() => {
    if (user) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  const handleAppleSignIn = async () => {
    try {
      // COMMENTED OUT FOR DEMO - Skip Apple authentication
      // This is a placeholder for Apple Sign-In implementation
      // In a real implementation, you would integrate with Apple's Sign-In JS SDK
      // For now, we'll simulate the login process
      
      // Mock Apple Sign-In response
      const mockResponse = {
        identityToken: 'mock_identity_token',
        authorizationCode: 'mock_authorization_code',
        user: {
          name: {
            firstName: 'John',
            lastName: 'Doe',
          },
          email: 'john.doe@example.com',
        },
      };

      // COMMENTED OUT FOR DEMO - Original authentication call
      // await login(
      //   mockResponse.identityToken,
      //   mockResponse.authorizationCode,
      //   mockResponse.user
      // );
      
      // For demo: Use demo login that bypasses authentication
      demoLogin(mockResponse.user);
      // Navigation will happen via useEffect when user state updates
    } catch (error: any) {
      console.error('Apple Sign-In failed:', error);
      // Error is already shown via toast in AuthContext
    }
  };

  const handleDevelopmentLogin = async () => {
    try {
      console.log('Development login button clicked');
      // Simple development login that bypasses Apple authentication
      const mockResponse = {
        identityToken: 'dev_login_token',
        authorizationCode: 'dev_auth_code',
        user: {
          name: {
            firstName: 'Dev',
            lastName: 'User',
          },
          email: 'dev.user@scorecheck.com',
        },
      };

      // COMMENTED OUT FOR DEMO - Original authentication call
      // console.log('Calling login with:', mockResponse);
      // await login(
      //   mockResponse.identityToken,
      //   mockResponse.authorizationCode,
      //   mockResponse.user
      // );
      
      // For demo: Use demo login that bypasses authentication
      console.log('Calling demo login with:', mockResponse);
      demoLogin(mockResponse.user);
      console.log('Login completed successfully');
      // Navigation will happen via useEffect when user state updates
    } catch (error: any) {
      console.error('Development login failed:', error);
      // Error is already shown via toast in AuthContext
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-12 w-12 basketball-gradient rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">🏀</span>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Welcome to ScoreCheck
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Sign in to analyze your NBA 2K25 box scores
          </p>
        </div>
        
        <div className="mt-8 space-y-6">
          <div>
            <button
              onClick={handleAppleSignIn}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors duration-200"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              Sign in with Apple
            </button>
          </div>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-gray-50 text-gray-500">Or</span>
            </div>
          </div>
          
          <div>
            <button
              onClick={handleDevelopmentLogin}
              className="group relative w-full flex justify-center py-3 px-4 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors duration-200"
            >
              <svg className="w-5 h-5 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Development Login (Skip Apple)
            </button>
          </div>
          
          <div className="text-center space-y-2">
            <p className="text-xs text-gray-500">
              By signing in, you agree to our Terms of Service and Privacy Policy
            </p>
            <div>
              <Link 
                to="/icloud-2fa" 
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Need help with iCloud authentication?
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-blue-800 mb-2">
              🚀 Demo Mode
            </h3>
            <p className="text-xs text-blue-700">
              This is a demo version. Click "Sign in with Apple" to simulate authentication and explore the app features.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
