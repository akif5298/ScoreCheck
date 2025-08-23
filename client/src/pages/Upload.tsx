import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { CloudArrowUpIcon } from '@heroicons/react/24/outline';
import ReviewStats from '../components/ReviewStats';
import PlayerNameAssignment from '../components/PlayerNameAssignment';

// Interface for PlayerNameAssignment component
interface PlayerNameAssignmentPlayerStats {
  name: string;
  team: string;
  teammateGrade: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fouls: number;
  turnovers: number;
  fgMade: number;
  fgAttempted: number;
  threeMade: number;
  threeAttempted: number;
  ftMade: number;
  ftAttempted: number;
}

// Interface for ReviewStats component
interface ReviewStatsPlayerStats {
  name: string;
  team: string;
  teammateGrade: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fouls: number;
  turnovers: number;
  fgMade: number;
  fgAttempted: number;
  threeMade: number;
  threeAttempted: number;
  ftMade: number;
  ftAttempted: number;
  id: string;
}

interface ExtractedData {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  players: PlayerNameAssignmentPlayerStats[];
  teamAQuarters?: { [key: string]: number };
  teamBQuarters?: { [key: string]: number };
  teamATotals?: {
    points: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    fouls: number;
    turnovers: number;
    fgMade: number;
    fgAttempted: number;
    threeMade: number;
    threeAttempted: number;
    ftMade: number;
    ftAttempted: number;
  };
  teamBTotals?: {
    points: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    fouls: number;
    turnovers: number;
    fgMade: number;
    fgAttempted: number;
    threeMade: number;
    threeAttempted: number;
    ftMade: number;
    ftAttempted: number;
  };
}

interface ProcessedGame {
  extractedData: ExtractedData;
  imageUrl: string;
  fileName: string;
  hasPlayerAssignment: boolean;
}

const Upload: React.FC = () => {
  const [processedGame, setProcessedGame] = useState<ProcessedGame | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPlayerAssignment, setShowPlayerAssignment] = useState(false);

  // Debug: Monitor processedGame state changes
  useEffect(() => {
    console.log('🔍 processedGame state changed:', processedGame);
    if (processedGame) {
      console.log('🔍 processedGame.extractedData.players count:', processedGame.extractedData.players.length);
      console.log('🔍 processedGame.hasPlayerAssignment:', processedGame.hasPlayerAssignment);
      
      // Debug: Check if players array is intact
      if (processedGame.extractedData.players) {
        console.log('🔍 Players array details:');
        console.log('  Array length:', processedGame.extractedData.players.length);
        console.log('  Is array:', Array.isArray(processedGame.extractedData.players));
        console.log('  First player:', processedGame.extractedData.players[0]);
        console.log('  Last player:', processedGame.extractedData.players[processedGame.extractedData.players.length - 1]);
      }
    }
  }, [processedGame]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0]; // Only process first file
    setIsProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('screenshot', file);

      const response = await fetch('/api/screenshots/upload', {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });

      if (response.ok) {
        const result = await response.json();
        
        // Convert the image buffer to a data URL that can be displayed
        let imageUrl = '';
        if (result.data.originalImageUrl) {
          imageUrl = result.data.originalImageUrl;
        } else {
          // Fallback: create a data URL from the original file
      const reader = new FileReader();
          const filePromise = new Promise<string>((resolve) => {
            reader.onload = () => resolve(reader.result as string);
          });
          reader.readAsDataURL(file);
          imageUrl = await filePromise;
        }

        // Debug: Log what we received from the backend
        console.log('🔍 Backend response received:', result.data);
        console.log('🔍 Players received from backend:', result.data.extractedData.players);
        console.log('🔍 Player count received:', result.data.extractedData.players.length);
        
        const game: ProcessedGame = {
          extractedData: result.data.extractedData,
          imageUrl: imageUrl,
          fileName: file.name,
          hasPlayerAssignment: false,
        };

        setProcessedGame(game);
        setShowPlayerAssignment(true); // Show player assignment first
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to process image');
      }
    } catch (error) {
      console.error('Upload error:', error);
      setError('Failed to upload image');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif']
    },
    multiple: false
  });

  const handlePlayerAssignmentComplete = (updatedPlayers: PlayerNameAssignmentPlayerStats[]) => {
    console.log('🔍 handlePlayerAssignmentComplete called with:', updatedPlayers.map(p => ({ name: p.name, team: p.team })));
    console.log('🔍 Player count in handlePlayerAssignmentComplete:', updatedPlayers.length);
    
    // The PlayerNameAssignment component now returns players with custom team names already applied
    // We need to extract the team names from the players, but now they might not be "Team A" vs "Team B"
    // Get unique team names from the updated players
    const uniqueTeams = [...new Set(updatedPlayers.map(p => p.team))];
    console.log('🔍 Unique teams after assignment:', uniqueTeams);
    
    // For now, let's use the first two unique teams as home and away
    // This preserves the OCR team detection while allowing custom names
    const homeTeam = uniqueTeams[0] || 'Team A';
    const awayTeam = uniqueTeams[1] || 'Team B';
    
    console.log('🔍 Extracted team names:', { homeTeam, awayTeam });

    // Update the current game with the assigned players and custom team names
    setProcessedGame(prev => {
      if (!prev) return null;
      
      const newProcessedGame = {
        ...prev,
        extractedData: {
          ...prev.extractedData,
          players: updatedPlayers,
          homeTeam: homeTeam,
          awayTeam: awayTeam
        },
        hasPlayerAssignment: true
      };
      
      console.log('🔍 About to update processedGame state:');
      console.log('  updatedPlayers count:', updatedPlayers.length);
      console.log('  newProcessedGame.extractedData.players count:', newProcessedGame.extractedData.players.length);
      console.log('  newProcessedGame:', newProcessedGame);
      
      return newProcessedGame;
    });

    setShowPlayerAssignment(false);
  };

  // Convert players to ReviewStats format
  const convertPlayersForReviewStats = (players: PlayerNameAssignmentPlayerStats[]): ReviewStatsPlayerStats[] => {
    console.log('🔍 convertPlayersForReviewStats called with:', players.length, 'players');
    console.log('🔍 Players before conversion:', players.map(p => ({ name: p.name, team: p.team })));
    
    const converted = players.map((player, index) => ({
      ...player,
      id: `player_${index}_${Date.now()}` // Generate a unique ID
    }));
    
    console.log('🔍 Players after conversion:', converted.length, 'players');
    console.log('🔍 Converted players:', converted.map(p => ({ id: p.id, name: p.name, team: p.team })));
    
    return converted;
  };

  const handleSaveGame = async () => {
    try {
      // Get the current data from ReviewStats component
      // We'll need to access this through a ref or state management
      // For now, we'll use the processedGame data
      const gameData = {
        homeTeam: processedGame?.extractedData.homeTeam || 'Team A',
        awayTeam: processedGame?.extractedData.awayTeam || 'Team B',
        homeScore: processedGame?.extractedData.homeScore || 0,
        awayScore: processedGame?.extractedData.awayScore || 0,
        date: new Date().toISOString().split('T')[0],
      };

      const playersData = processedGame?.extractedData.players || [];

      const response = await fetch('/api/screenshots/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          gameData,
          playersData,
          originalImageBuffer: processedGame?.imageUrl,
        }),
      });

      if (response.ok) {
        // Reset and show success
        setProcessedGame(null);
        setShowPlayerAssignment(false);
        alert('Game saved successfully!');
      } else {
        const errorData = await response.json();
        alert(`Failed to save game: ${errorData.error}`);
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save game');
    }
  };

  const handleBack = () => {
    if (showPlayerAssignment) {
      setShowPlayerAssignment(false);
    } else {
      setProcessedGame(null);
      setError(null);
    }
  };

  // Show PlayerNameAssignment if current game needs it
  if (showPlayerAssignment && processedGame) {
      return (
        <PlayerNameAssignment
        players={processedGame.extractedData.players}
        onComplete={handlePlayerAssignmentComplete}
        onClose={() => setShowPlayerAssignment(false)}
      />
    );
  }

    // Show ReviewStats if current game is ready for review
  if (processedGame && processedGame.hasPlayerAssignment) {
    console.log('🔍 Rendering ReviewStats with processedGame:', processedGame);
    console.log('🔍 Players in processedGame:', processedGame.extractedData.players.length);
    
    // Debug: Check if players array is intact before conversion
    if (processedGame.extractedData.players) {
      console.log('🔍 Players array before conversion:');
      console.log('  Length:', processedGame.extractedData.players.length);
      console.log('  Is array:', Array.isArray(processedGame.extractedData.players));
      console.log('  Sample players:', processedGame.extractedData.players.slice(0, 3).map(p => ({ name: p.name, team: p.team })));
    }
    
    const reviewStatsData = {
      ...processedGame.extractedData,
      players: convertPlayersForReviewStats(processedGame.extractedData.players)
    };
    
    console.log('🔍 Final reviewStatsData:', reviewStatsData);
    console.log('🔍 Final player count for ReviewStats:', reviewStatsData.players.length);

    return (
      <ReviewStats
        extractedData={reviewStatsData}
        originalImageUrl={processedGame.imageUrl}
        originalFileName={processedGame.fileName}
        onBack={handleBack}
        onSave={handleSaveGame}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">
            Upload Box Score Screenshot
          </h1>
          <p className="text-lg text-gray-600 mb-8">
            Upload a screenshot of a box score to extract and review the game data
          </p>
      </div>

                 <div className="bg-white rounded-lg shadow-lg p-8">
          <div
            {...getRootProps()}
             className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
              isDragActive
                 ? 'border-blue-400 bg-blue-50'
                 : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input {...getInputProps()} />
             <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400 mb-4" />
             
             {isProcessing ? (
               <div className="space-y-4">
                 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                 <p className="text-gray-600">Processing image...</p>
               </div>
              ) : (
                <div>
                 <p className="text-lg text-gray-600 mb-4">
                   {isDragActive
                     ? 'Drop the file here...'
                     : 'Drag and drop your screenshot here, or click to browse'}
                 </p>
                 <p className="text-sm text-gray-500 mb-4">
                   Supported formats: JPEG, PNG, GIF (Max 10MB)
                  </p>
                </div>
              )}

             {error && (
               <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                 <p className="text-red-800">{error}</p>
            </div>
          )}
        </div>
          </div>
        </div>
    </div>
  );
};

export default Upload;
