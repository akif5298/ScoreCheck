import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { CloudArrowUpIcon } from '@heroicons/react/24/outline';
import ReviewStats from '../components/ReviewStats';
import PlayerNameAssignment from '../components/PlayerNameAssignment';
import toast from 'react-hot-toast';

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
  processedAt?: string;
}

interface ProcessingFile {
  file: File;
  fileName: string;
  status: 'processing' | 'ready' | 'reviewing' | 'completed' | 'error';
  processedGame?: ProcessedGame;
  error?: string;
}

interface MultipleUploadState {
  files: ProcessingFile[];
  currentlyReviewing: number | null;
  isUploading: boolean;
  processingComplete: boolean;
}

const Upload: React.FC = () => {
  // Legacy single upload state (keep for backward compatibility)
  const [processedGame, setProcessedGame] = useState<ProcessedGame | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPlayerAssignment, setShowPlayerAssignment] = useState(false);
  
  // New multiple upload state
  const [multipleUploadState, setMultipleUploadState] = useState<MultipleUploadState>({
    files: [],
    currentlyReviewing: null,
    isUploading: false,
    processingComplete: false
  });
  const [isMultipleMode, setIsMultipleMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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

  // Debug: Monitor multipleUploadState changes
  useEffect(() => {
    console.log('🔍 multipleUploadState changed:', {
      filesCount: multipleUploadState.files.length,
      currentlyReviewing: multipleUploadState.currentlyReviewing,
      isUploading: multipleUploadState.isUploading,
      processingComplete: multipleUploadState.processingComplete,
      fileStatuses: multipleUploadState.files.map(f => ({ fileName: f.fileName, status: f.status }))
    });
  }, [multipleUploadState]);

  // Multiple file upload handler
  const handleMultipleUpload = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    console.log(`🚀 Starting multiple upload with ${acceptedFiles.length} files`);
    
    // Initialize state
    const initialFiles: ProcessingFile[] = acceptedFiles.map(file => ({
      file,
      fileName: file.name,
      status: 'processing'
    }));

    setMultipleUploadState({
      files: initialFiles,
      currentlyReviewing: null,
      isUploading: true,
      processingComplete: false
    });
    setIsMultipleMode(true);
    setError(null);

    try {
      const formData = new FormData();
      acceptedFiles.forEach(file => {
        formData.append('screenshots', file);
      });

      const response = await fetch('/api/screenshots/upload-multiple', {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });

      if (response.ok) {
        const result = await response.json();
        console.log('🎉 Multiple upload completed:', result.data);
        console.log('🔍 Raw results:', result.data.results);
        console.log('🔍 First result imageUrl:', result.data.results[0]?.originalImageUrl);

        // Convert results to processed games and update state
        const processedFiles: ProcessingFile[] = result.data.results.map((processedResult: any, index: number) => {
          console.log(`🔍 Processing result ${index}:`, processedResult);
          console.log(`🔍 Image URL from backend:`, processedResult.originalImageUrl);
          
          return {
            file: acceptedFiles[index],
            fileName: acceptedFiles[index].name,
            status: 'ready' as const,
            processedGame: {
              extractedData: processedResult.extractedData,
              imageUrl: processedResult.originalImageUrl,
              fileName: processedResult.fileName,
              hasPlayerAssignment: false,
              processedAt: processedResult.processedAt
            }
          };
        });

        // Mark the first file as reviewing and set it for review
        const filesWithFirstReviewing = processedFiles.map((file, index) => 
          index === 0 ? { ...file, status: 'reviewing' as const } : file
        );

        setMultipleUploadState(prev => ({
          ...prev,
          files: filesWithFirstReviewing,
          isUploading: false,
          processingComplete: true,
          currentlyReviewing: 0 // Start with first file
        }));

        // Set the first file for review
        if (processedFiles.length > 0 && processedFiles[0].processedGame) {
          console.log('🔍 Setting first file for review:', processedFiles[0].processedGame);
          console.log('🔍 Image URL:', processedFiles[0].processedGame.imageUrl);
          setProcessedGame(processedFiles[0].processedGame);
          setShowPlayerAssignment(true);
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to process images');
        setMultipleUploadState(prev => ({ ...prev, isUploading: false }));
      }
    } catch (error) {
      console.error('Multiple upload error:', error);
      setError('Failed to upload images');
      setMultipleUploadState(prev => ({ ...prev, isUploading: false }));
    }
  }, []);

  // Single file upload handler (legacy)
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    // Check if multiple files - use multiple upload flow
    if (acceptedFiles.length > 1) {
      return handleMultipleUpload(acceptedFiles);
    }

    // Single file upload (existing logic)
    const file = acceptedFiles[0];
    setIsProcessing(true);
    setError(null);
    setIsMultipleMode(false);

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

        const game: ProcessedGame = {
          extractedData: result.data.extractedData,
          imageUrl: imageUrl,
          fileName: file.name,
          hasPlayerAssignment: false,
        };

        setProcessedGame(game);
        setShowPlayerAssignment(true);
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
  }, [handleMultipleUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif']
    },
    multiple: true // Enable multiple file selection
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

  const handleSaveGame = async (gameData: any, playersData: any, fileName: string) => {
    if (isSaving) {
      console.log('🔄 Save already in progress, ignoring duplicate request');
      return;
    }

    console.log('🎯 handleSaveGame called with data:', { gameData, playersData, fileName });

    setIsSaving(true);
    try {
      const response = await fetch('/api/screenshots/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          gameData,
          playersData,
          imageUrl: processedGame?.imageUrl,
          originalFileName: fileName,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          toast.success('Game saved successfully!');
          
          // Check if we're in multiple upload mode
          if (isMultipleMode && multipleUploadState.files.length > 0) {
            console.log('🎯 Multiple upload mode detected, moving to next file...');
            // Add a small delay to ensure state updates are processed
            setTimeout(() => {
              handleNextFileInQueue();
            }, 100);
          } else {
            // Single upload mode - reset everything
            setProcessedGame(null);
            setShowPlayerAssignment(false);
          }
        } else {
          toast.error(result.message || 'Failed to save game');
        }
      } else {
        const errorData = await response.json();
        toast.error(`Failed to save game: ${errorData.error}`);
      }
    } catch (error) {
      console.error('Error saving game:', error);
      toast.error('Failed to save game');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle moving to next file in the queue (continuous flow)
  const handleNextFileInQueue = () => {
    const currentIndex = multipleUploadState.currentlyReviewing;
    if (currentIndex === null) return;

    console.log(`🎯 handleNextFileInQueue called for current index: ${currentIndex}`);

    // Get current state and update it directly to avoid timing issues
    const currentState = multipleUploadState;
    
    // Mark current file as completed and find next file
    const updatedFiles = currentState.files.map((file, index) => 
      index === currentIndex 
        ? { ...file, status: 'completed' as const }
        : file
    );
    
    console.log(`✅ Marked file ${currentIndex} as completed`);

    // Find next file to review
    const nextIndex = updatedFiles.findIndex((file, index) => 
      index > currentIndex && file.status === 'ready'
    );

    console.log(`🔍 Next file index found: ${nextIndex}`);
    console.log(`🔍 All file statuses:`, updatedFiles.map((f, i) => ({ index: i, fileName: f.fileName, status: f.status })));
    
    // If no 'ready' file found, look for any file that's not completed
    if (nextIndex === -1) {
      const alternativeNextIndex = updatedFiles.findIndex((file, index) => 
        index > currentIndex && file.status !== 'completed'
      );
      console.log(`🔍 Alternative next index found: ${alternativeNextIndex}`);
      if (alternativeNextIndex !== -1) {
        // Update the status to 'ready' if it's not already
        updatedFiles[alternativeNextIndex] = { ...updatedFiles[alternativeNextIndex], status: 'ready' as const };
        console.log(`🔍 Updated file ${alternativeNextIndex} status to 'ready'`);
        // Use the alternative index
        const finalNextIndex = alternativeNextIndex;
        const nextFile = updatedFiles[finalNextIndex];
        if (nextFile.processedGame) {
          console.log(`🎯 Moving to alternative next file: ${nextFile.fileName} (${finalNextIndex + 1}/${updatedFiles.length})`);
          
          // Update state with both the completed file and the next file status
          setMultipleUploadState({
            ...currentState,
            currentlyReviewing: finalNextIndex,
            files: updatedFiles.map((file, index) => 
              index === finalNextIndex 
                ? { ...file, status: 'reviewing' as const }
                : file
            )
          });

          setProcessedGame(nextFile.processedGame);
          setShowPlayerAssignment(true);
          return; // Exit early since we handled the alternative case
        }
      }
    }

    if (nextIndex !== -1) {
      // Move to next file
      const nextFile = updatedFiles[nextIndex];
      if (nextFile.processedGame) {
        console.log(`🎯 Moving to next file: ${nextFile.fileName} (${nextIndex + 1}/${updatedFiles.length})`);
        
        // Update state with both the completed file and the next file status
        setMultipleUploadState({
          ...currentState,
          currentlyReviewing: nextIndex,
          files: updatedFiles.map((file, index) => 
            index === nextIndex 
              ? { ...file, status: 'reviewing' as const }
              : file
          )
        });

        setProcessedGame(nextFile.processedGame);
        setShowPlayerAssignment(true);
      }
    } else {
      // All files completed
      console.log('🎉 All files completed!');
      toast.success(`All ${updatedFiles.length} games saved successfully!`);
      
      // Reset everything
      setProcessedGame(null);
      setShowPlayerAssignment(false);
      setMultipleUploadState({
        files: [],
        currentlyReviewing: null,
        isUploading: false,
        processingComplete: false
      });
      setIsMultipleMode(false);
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
        isSaving={isSaving}
      />
    );
  }

  // Render queue progress UI for multiple files
  const renderQueueProgress = () => {
    if (!isMultipleMode || multipleUploadState.files.length === 0) return null;

    const completedCount = multipleUploadState.files.filter(f => f.status === 'completed').length;
    const totalCount = multipleUploadState.files.length;
    const currentFile = multipleUploadState.currentlyReviewing !== null 
      ? multipleUploadState.files[multipleUploadState.currentlyReviewing]
      : null;

    return (
      <div className="mb-8 bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">
            Processing Queue ({completedCount}/{totalCount} completed)
          </h2>
          <div className="text-sm text-gray-500">
            {currentFile ? `Currently reviewing: ${currentFile.fileName}` : 'Ready to review'}
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(completedCount / totalCount) * 100}%` }}
          ></div>
        </div>

        {/* File status list */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {multipleUploadState.files.map((file, index) => (
            <div 
              key={index}
              className={`p-3 rounded-lg border-2 transition-all ${
                file.status === 'completed' 
                  ? 'border-green-200 bg-green-50' 
                  : file.status === 'reviewing'
                  ? 'border-blue-200 bg-blue-50'
                  : file.status === 'ready'
                  ? 'border-yellow-200 bg-yellow-50'
                  : file.status === 'processing'
                  ? 'border-gray-200 bg-gray-50'
                  : 'border-red-200 bg-red-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900 truncate">
                  {file.fileName}
                </span>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                  file.status === 'completed' 
                    ? 'bg-green-100 text-green-800'
                    : file.status === 'reviewing'
                    ? 'bg-blue-100 text-blue-800'
                    : file.status === 'ready'
                    ? 'bg-yellow-100 text-yellow-800'
                    : file.status === 'processing'
                    ? 'bg-gray-100 text-gray-800'
                    : 'bg-red-100 text-red-800'
                }`}>
                  {file.status === 'reviewing' ? 'Current' : 
                   file.status === 'ready' ? 'Ready' :
                   file.status === 'completed' ? 'Done' :
                   file.status === 'processing' ? 'Processing' : 'Error'}
                </span>
              </div>
              {file.status === 'processing' && (
                <div className="mt-2">
                  <div className="animate-pulse h-1 bg-gray-300 rounded"></div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">
            Upload Box Score Screenshot{isMultipleMode ? 's' : ''}
          </h1>
          <p className="text-lg text-gray-600 mb-8">
            {isMultipleMode 
              ? 'Processing multiple screenshots - review each game as they complete'
              : 'Upload a screenshot of a box score to extract and review the game data'
            }
          </p>
        </div>

        {/* Queue Progress UI */}
        {renderQueueProgress()}

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
             
             {isProcessing || multipleUploadState.isUploading ? (
               <div className="space-y-4">
                 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                 <p className="text-gray-600">
                   {multipleUploadState.isUploading 
                     ? `Processing ${multipleUploadState.files.length} files...`
                     : 'Processing image...'
                   }
                 </p>
               </div>
              ) : (
                <div>
                 <p className="text-lg text-gray-600 mb-4">
                   {isDragActive
                     ? 'Drop the files here...'
                     : 'Drag and drop your screenshots here, or click to browse'}
                 </p>
                 <p className="text-sm text-gray-500 mb-4">
                   Supported formats: JPEG, PNG, GIF (Max 10MB each)<br/>
                   <span className="font-medium text-blue-600">
                     Select multiple files for continuous processing!
                   </span>
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
