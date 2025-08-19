import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { ArrowUpTrayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import ReviewStats from '../components/ReviewStats';
import PlayerNameAssignment from '../components/PlayerNameAssignment';

interface ExtractedData {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  players: any[];
  teamAQuarters?: { [key: string]: number };
  teamBQuarters?: { [key: string]: number };
}

const Upload: React.FC = () => {
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState<string | null>(null);
  const [showNameAssignment, setShowNameAssignment] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setUploadedFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif']
    },
    multiple: false,
    maxSize: 10 * 1024 * 1024, // 10MB
  });

  const handleUpload = async () => {
    if (!uploadedFile) {
      toast.error('Please select a file first');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('screenshot', uploadedFile);

    try {
      const response = await axios.post('/api/screenshots/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.success) {
        setExtractedData(response.data.data.extractedData);
        setOriginalImageUrl(response.data.data.originalImageUrl);
        setOriginalFileName(response.data.data.originalFileName);
        setShowNameAssignment(true);
        toast.success('Box score extracted successfully! Please assign player names.');
      } else {
        throw new Error(response.data.error || 'Upload failed');
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.response?.data?.error || 'Failed to upload screenshot');
    } finally {
      setUploading(false);
    }
  };

  const removeFile = () => {
    setUploadedFile(null);
    setPreview(null);
  };

  const handleBackToUpload = () => {
    setExtractedData(null);
    setOriginalImageUrl(null);
    setOriginalFileName(null);
    setUploadedFile(null);
    setPreview(null);
    setShowNameAssignment(false);
  };

  const handleNameAssignmentComplete = async (updatedPlayers: any[]) => {
    console.log('🔍 Original OCR data:', extractedData?.players);
    console.log('🔍 Updated players after name assignment:', updatedPlayers);
    console.log('🔍 Team breakdown after name assignment:');
    const teamAPlayers = updatedPlayers.filter(p => p.team === 'Team A');
    const teamBPlayers = updatedPlayers.filter(p => p.team === 'Team B');
    console.log(`   Team A: ${teamAPlayers.length} players (${teamAPlayers.map(p => p.name).join(', ')})`);
    console.log(`   Team B: ${teamBPlayers.length} players (${teamBPlayers.map(p => p.name).join(', ')})`);
    
    try {
      // Generate custom team names based on the assigned players
      console.log('🔍 Calling team name generation API...');
      const teamNameResponse = await axios.post('/api/screenshots/generate-team-names', {
        players: updatedPlayers
      });

      if (teamNameResponse.data.success) {
        const { teamAName, teamBName } = teamNameResponse.data.data;
        console.log('🔍 Generated custom team names:', { teamAName, teamBName });

        // Update players to have custom team names in their team property
        const playersWithCustomTeamNames = updatedPlayers.map(player => ({
          ...player,
          team: player.team === 'Team A' ? teamAName : (player.team === 'Team B' ? (teamBName || 'Team B') : player.team)
        }));

        console.log('🔍 Updated players with custom team names:', playersWithCustomTeamNames.map(p => ({ name: p.name, team: p.team })));

        // Update extracted data with new players and custom team names
        setExtractedData({
          ...extractedData!,
          players: playersWithCustomTeamNames,
          homeTeam: teamAName,
          awayTeam: teamBName || 'Team B'
        });
      } else {
        console.warn('⚠️ Team name generation failed, using generic names');
        setExtractedData({
          ...extractedData!,
          players: updatedPlayers
        });
      }
    } catch (error) {
      console.error('❌ Error generating team names:', error);
      toast.error('Failed to generate custom team names, using generic names');
      
      // Fallback to original data with updated players
      setExtractedData({
        ...extractedData!,
        players: updatedPlayers
      });
    }

    setShowNameAssignment(false);
  };

  const handleSaveComplete = () => {
    // Redirect to dashboard after successful save
    navigate('/');
  };

  // Show name assignment overlay first, then review screen
  if (extractedData && originalImageUrl && originalFileName) {
    if (showNameAssignment) {
      return (
        <PlayerNameAssignment
          players={extractedData.players}
          onComplete={handleNameAssignmentComplete}
          onClose={() => setShowNameAssignment(false)}
        />
      );
    } else {
      return (
        <ReviewStats
          extractedData={extractedData}
          originalImageUrl={originalImageUrl}
          originalFileName={originalFileName}
          onBack={handleBackToUpload}
          onSave={handleSaveComplete}
        />
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Upload Box Score</h1>
        <p className="text-gray-600">Upload a screenshot of your NBA 2K25 box score to extract and analyze the data</p>
      </div>

      {/* Upload Area */}
      <div className="card">
        <div className="space-y-4">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors duration-200 ${
              isDragActive
                ? 'border-primary-400 bg-primary-50'
                : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
            }`}
          >
            <input {...getInputProps()} />
            <ArrowUpTrayIcon className="mx-auto h-12 w-12 text-gray-400" />
            <div className="mt-4">
              {isDragActive ? (
                <p className="text-primary-600">Drop the screenshot here...</p>
              ) : (
                <div>
                  <p className="text-gray-600">
                    Drag and drop a screenshot here, or{' '}
                    <span className="text-primary-600 hover:text-primary-500">
                      click to select
                    </span>
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    Supports JPG, PNG, GIF up to 10MB
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* File Preview */}
          {uploadedFile && (
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                    <div className="w-5 h-5 bg-primary-600 rounded"></div>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{uploadedFile.name}</p>
                    <p className="text-sm text-gray-500">
                      {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>
                <button
                  onClick={removeFile}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors duration-200"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
              
              {/* Image Preview */}
              {preview && (
                <div className="mt-4">
                  <img
                    src={preview}
                    alt="Preview"
                    className="max-w-full h-64 object-contain rounded-lg border border-gray-200"
                  />
                </div>
              )}
            </div>
          )}

          {/* Upload Button */}
          {uploadedFile && (
            <div className="flex justify-end">
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {uploading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <ArrowUpTrayIcon className="w-4 h-4" />
                    <span>Upload & Extract Data</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">How to get the best results</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-gray-900 mb-2">📱 Screenshot Tips</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Take a clear, high-resolution screenshot</li>
              <li>• Ensure all text is readable and not cut off</li>
              <li>• Include the complete box score section</li>
              <li>• Avoid blurry or distorted images</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 mb-2">🔍 What we extract</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Player names and statistics</li>
              <li>• Team scores and totals</li>
              <li>• Shooting percentages</li>
              <li>• Game date and teams</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Enhanced OCR Notice */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-green-800 mb-2">
          🚀 Enhanced OCR Processing
        </h3>
        <p className="text-sm text-green-700">
          Our enhanced OCR system uses optimized coordinates and advanced preprocessing to achieve 100% accuracy. 
          Images are automatically enhanced using multi-strategy preprocessing before text extraction.
        </p>
      </div>

      {/* Processing Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-2">
          🔍 Data Extraction Process
        </h3>
        <p className="text-sm text-blue-700">
          After upload, we'll automatically preprocess your image and extract all player statistics using optimized coordinates. 
          You'll then be able to review and edit the data before saving it to your database.
        </p>
      </div>


    </div>
  );
};

export default Upload;
