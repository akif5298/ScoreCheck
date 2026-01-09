import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import toast from 'react-hot-toast';

interface PlayerStats {
  id: string;
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
  plusMinus?: number;
}

interface GameData {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  date: string;
  players: PlayerStats[];
  teams?: any[];
  screenshotUrl?: string;
}

const EditGame: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [imageZoomed, setImageZoomed] = useState(false);
  const [showFullScreenImage, setShowFullScreenImage] = useState(false);

  const startGameEdit = useCallback(async () => {
    try {
      // Call the start-edit endpoint to subtract current stats from totals
      await axios.post(`/api/screenshots/games/${gameId}/start-edit`);
      console.log('Game edit started - current stats subtracted from totals');
    } catch (error) {
      console.error('Error starting game edit:', error);
      // Don't show error to user, just log it
    }
  }, [gameId]);

  const fetchGameData = useCallback(async () => {
    try {
      setLoading(true);
      // You'll need to create this API endpoint
      const response = await axios.get(`/api/screenshots/games/${gameId}`);
      if (response.data.success) {
        const game = response.data.data;
        setGameData(game);
        setPlayers(game.players || []);
      }
    } catch (error) {
      console.error('Error fetching game data:', error);
      toast.success('Loaded demo data');
      // For now, use mock data
      const mockGame: GameData = {
        id: gameId || '1',
        homeTeam: 'Lakers',
        awayTeam: 'Celtics',
        homeScore: 108,
        awayScore: 95,
        date: new Date().toISOString().split('T')[0],
        screenshotUrl: 'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&h=600&fit=crop&crop=center',
        players: [
          {
            id: '1',
            name: 'LeBron James',
            team: 'Lakers',
            teammateGrade: 'A+',
            points: 25,
            rebounds: 8,
            assists: 10,
            steals: 2,
            blocks: 1,
            fouls: 2,
            turnovers: 3,
            fgMade: 10,
            fgAttempted: 18,
            threeMade: 2,
            threeAttempted: 5,
            ftMade: 3,
            ftAttempted: 4,
          },
          {
            id: '2',
            name: 'Anthony Davis',
            team: 'Lakers',
            teammateGrade: 'A',
            points: 22,
            rebounds: 12,
            assists: 3,
            steals: 1,
            blocks: 3,
            fouls: 1,
            turnovers: 1,
            fgMade: 9,
            fgAttempted: 15,
            threeMade: 0,
            threeAttempted: 1,
            ftMade: 4,
            ftAttempted: 5,
          },
          {
            id: '3',
            name: 'Jayson Tatum',
            team: 'Celtics',
            teammateGrade: 'A-',
            points: 20,
            rebounds: 6,
            assists: 4,
            steals: 1,
            blocks: 0,
            fouls: 3,
            turnovers: 2,
            fgMade: 8,
            fgAttempted: 16,
            threeMade: 2,
            threeAttempted: 6,
            ftMade: 2,
            ftAttempted: 3,
          },
          {
            id: '4',
            name: 'Jaylen Brown',
            team: 'Celtics',
            teammateGrade: 'B+',
            points: 18,
            rebounds: 5,
            assists: 2,
            steals: 2,
            blocks: 1,
            fouls: 2,
            turnovers: 1,
            fgMade: 7,
            fgAttempted: 14,
            threeMade: 1,
            threeAttempted: 4,
            ftMade: 3,
            ftAttempted: 4,
          },
          {
            id: '5',
            name: 'Akif',
            team: 'Lakers',
            teammateGrade: 'A',
            points: 15,
            rebounds: 4,
            assists: 6,
            steals: 3,
            blocks: 0,
            fouls: 1,
            turnovers: 2,
            fgMade: 6,
            fgAttempted: 12,
            threeMade: 1,
            threeAttempted: 3,
            ftMade: 2,
            ftAttempted: 2,
          },
          {
            id: '6',
            name: 'Abdul',
            team: 'Lakers',
            teammateGrade: 'B+',
            points: 12,
            rebounds: 3,
            assists: 4,
            steals: 1,
            blocks: 1,
            fouls: 2,
            turnovers: 1,
            fgMade: 5,
            fgAttempted: 10,
            threeMade: 0,
            threeAttempted: 2,
            ftMade: 2,
            ftAttempted: 3,
          },
          {
            id: '7',
            name: 'Anis',
            team: 'Celtics',
            teammateGrade: 'B',
            points: 10,
            rebounds: 2,
            assists: 3,
            steals: 0,
            blocks: 0,
            fouls: 1,
            turnovers: 1,
            fgMade: 4,
            fgAttempted: 8,
            threeMade: 1,
            threeAttempted: 2,
            ftMade: 1,
            ftAttempted: 2,
          },
          {
            id: '8',
            name: 'Nillan',
            team: 'Celtics',
            teammateGrade: 'B-',
            points: 8,
            rebounds: 1,
            assists: 2,
            steals: 1,
            blocks: 0,
            fouls: 0,
            turnovers: 1,
            fgMade: 3,
            fgAttempted: 6,
            threeMade: 0,
            threeAttempted: 1,
            ftMade: 2,
            ftAttempted: 2,
          }
        ]
      };
      setGameData(mockGame);
      setPlayers(mockGame.players);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    if (gameId) {
      startGameEdit();
      fetchGameData();
    }
  }, [gameId, startGameEdit, fetchGameData]);

  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowFullScreenImage(false);
      }
    };

    if (showFullScreenImage) {
      document.addEventListener('keydown', handleEscKey);
    }

    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [showFullScreenImage]);



  const handlePlayerChange = (index: number, field: keyof PlayerStats, value: string | number) => {
    const updatedPlayers = [...players];
    updatedPlayers[index] = {
      ...updatedPlayers[index],
      [field]: value,
    };
    setPlayers(updatedPlayers);
  };

  const handleGameDataChange = (field: keyof GameData, value: string | number) => {
    if (gameData) {
      setGameData({
        ...gameData,
        [field]: value,
      });
    }
  };

  const handleSave = async () => {
    if (!gameData) return;

    try {
      setSaving(true);
      // You'll need to create this API endpoint
      const response = await axios.put(`/api/screenshots/games/${gameId}`, {
        homeTeam: gameData.homeTeam,
        awayTeam: gameData.awayTeam,
        homeScore: gameData.homeScore,
        awayScore: gameData.awayScore,
        date: gameData.date,
        players: players,
      });

      if (response.data.success) {
        toast.success('Game updated successfully!');
        navigate('/games');
      } else {
        toast.error('Failed to update game');
      }
    } catch (error) {
      console.error('Update error:', error);
      toast.error('Failed to update game');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    navigate('/games');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!gameData) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-medium text-gray-900 mb-2">Game not found</h3>
        <p className="text-gray-600 mb-6">The game you're looking for doesn't exist.</p>
        <button onClick={() => navigate('/games')} className="btn-primary">
          Back to Games
        </button>
      </div>
    );
  }

  // Group players by team
  const homePlayers = players.filter(p => p.team === gameData.homeTeam);
  const awayPlayers = players.filter(p => p.team === gameData.awayTeam);

  // Calculate team totals
  const homeTeamTotals = {
    points: homePlayers.reduce((sum, p) => sum + p.points, 0),
    rebounds: homePlayers.reduce((sum, p) => sum + p.rebounds, 0),
    assists: homePlayers.reduce((sum, p) => sum + p.assists, 0),
    steals: homePlayers.reduce((sum, p) => sum + p.steals, 0),
    blocks: homePlayers.reduce((sum, p) => sum + p.blocks, 0),
    fouls: homePlayers.reduce((sum, p) => sum + p.fouls, 0),
    turnovers: homePlayers.reduce((sum, p) => sum + p.turnovers, 0),
    fgMade: homePlayers.reduce((sum, p) => sum + p.fgMade, 0),
    fgAttempted: homePlayers.reduce((sum, p) => sum + p.fgAttempted, 0),
    threeMade: homePlayers.reduce((sum, p) => sum + p.threeMade, 0),
    threeAttempted: homePlayers.reduce((sum, p) => sum + p.threeAttempted, 0),
    ftMade: homePlayers.reduce((sum, p) => sum + p.ftMade, 0),
    ftAttempted: homePlayers.reduce((sum, p) => sum + p.ftAttempted, 0),
  };

  const awayTeamTotals = {
    points: awayPlayers.reduce((sum, p) => sum + p.points, 0),
    rebounds: awayPlayers.reduce((sum, p) => sum + p.rebounds, 0),
    assists: awayPlayers.reduce((sum, p) => sum + p.assists, 0),
    steals: awayPlayers.reduce((sum, p) => sum + p.steals, 0),
    blocks: awayPlayers.reduce((sum, p) => sum + p.blocks, 0),
    fouls: awayPlayers.reduce((sum, p) => sum + p.fouls, 0),
    turnovers: awayPlayers.reduce((sum, p) => sum + p.turnovers, 0),
    fgMade: awayPlayers.reduce((sum, p) => sum + p.fgMade, 0),
    fgAttempted: awayPlayers.reduce((sum, p) => sum + p.fgAttempted, 0),
    threeMade: awayPlayers.reduce((sum, p) => sum + p.threeMade, 0),
    threeAttempted: awayPlayers.reduce((sum, p) => sum + p.threeAttempted, 0),
    ftMade: awayPlayers.reduce((sum, p) => sum + p.ftMade, 0),
    ftAttempted: awayPlayers.reduce((sum, p) => sum + p.ftAttempted, 0),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={handleCancel}
            className="p-2 text-gray-600 hover:text-gray-900 transition-colors duration-200"
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Edit Game</h1>
            <p className="text-gray-600">Edit game details and box score statistics</p>
          </div>
        </div>
        <div className="text-sm text-gray-500">
          Game ID: {gameData.id}
        </div>
      </div>

      {/* Top Section: Screenshot and Game Information Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Original Screenshot - Left Side */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Original Screenshot</h2>
          <div className="flex justify-center">
            <div className="max-w-full">
              {gameData.screenshotUrl ? (
                <div className="relative">
                  <img
                    src={gameData.screenshotUrl}
                    alt="Original box score screenshot"
                    className={`w-full h-auto rounded-lg shadow-md border border-gray-200 cursor-pointer transition-all duration-200 ${
                      imageZoomed ? 'scale-105' : 'hover:scale-102'
                    }`}
                    style={{ maxHeight: '400px', objectFit: 'contain' }}
                    onClick={() => setImageZoomed(!imageZoomed)}
                    title="Click to zoom in/out"
                  />
                  <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                    {imageZoomed ? 'Click to zoom out' : 'Click to zoom in'}
                  </div>
                  <button
                    onClick={() => setShowFullScreenImage(true)}
                    className="absolute top-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded hover:bg-opacity-70 transition-all duration-200"
                    title="View full screen"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="w-full h-64 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
                  <div className="text-center">
                    <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-gray-500">No screenshot available</p>
                  </div>
                </div>
              )}
              <p className="text-sm text-gray-500 text-center mt-2">
                {gameData.screenshotUrl ? 'Reference image for editing the box score data' : 'Screenshot not available for this game'}
              </p>
            </div>
          </div>
        </div>

        {/* Game Information - Right Side */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Game Information</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Home Team
                </label>
                <input
                  type="text"
                  value={gameData.homeTeam}
                  onChange={(e) => handleGameDataChange('homeTeam', e.target.value)}
                  className="input-field text-base font-medium"
                  placeholder="Home Team"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Away Team
                </label>
                <input
                  type="text"
                  value={gameData.awayTeam}
                  onChange={(e) => handleGameDataChange('awayTeam', e.target.value)}
                  className="input-field text-base font-medium"
                  placeholder="Away Team"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Home Score
                </label>
                <input
                  type="number"
                  value={gameData.homeScore}
                  onChange={(e) => handleGameDataChange('homeScore', parseInt(e.target.value) || 0)}
                  className="input-field text-base font-medium text-center"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Away Score
                </label>
                <input
                  type="number"
                  value={gameData.awayScore}
                  onChange={(e) => handleGameDataChange('awayScore', parseInt(e.target.value) || 0)}
                  className="input-field text-base font-medium text-center"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date
                </label>
                <input
                  type="date"
                  value={gameData.date}
                  onChange={(e) => handleGameDataChange('date', e.target.value)}
                  className="input-field text-base font-medium"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Player Statistics */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Player Statistics</h2>
        <div className="space-y-6">
          {/* Home Team Players */}
          <div className="card">
            <h3 className="text-md font-semibold text-gray-900 mb-4">Home Team Players ({gameData.homeTeam})</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[160px]">Player</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[140px]">Team</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">Grade</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">PTS</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">REB</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">AST</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">STL</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">BLK</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">FOULS</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">TO</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[140px]">FG</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[140px]">3PT</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[140px]">FT</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {homePlayers.map((player, index) => {
                    const originalIndex = players.indexOf(player);
                    return (
                      <tr key={player.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={player.name}
                            onChange={(e) => handlePlayerChange(originalIndex, 'name', e.target.value)}
                            className="input-field text-base font-medium min-w-[140px]"
                            placeholder="Player Name"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={player.team}
                            onChange={(e) => handlePlayerChange(originalIndex, 'team', e.target.value)}
                            className="input-field text-base font-medium min-w-[120px]"
                            placeholder="Team"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={player.teammateGrade}
                            onChange={(e) => handlePlayerChange(originalIndex, 'teammateGrade', e.target.value)}
                            className="input-field text-sm w-16 text-center"
                            placeholder="Grade"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.points}
                            onChange={(e) => handlePlayerChange(originalIndex, 'points', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.rebounds}
                            onChange={(e) => handlePlayerChange(originalIndex, 'rebounds', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.assists}
                            onChange={(e) => handlePlayerChange(originalIndex, 'assists', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.steals}
                            onChange={(e) => handlePlayerChange(originalIndex, 'steals', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.blocks}
                            onChange={(e) => handlePlayerChange(originalIndex, 'blocks', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.fouls}
                            onChange={(e) => handlePlayerChange(originalIndex, 'fouls', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.turnovers}
                            onChange={(e) => handlePlayerChange(originalIndex, 'turnovers', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              value={player.fgMade}
                              onChange={(e) => handlePlayerChange(originalIndex, 'fgMade', parseInt(e.target.value) || 0)}
                              className="input-field text-sm w-16 text-center"
                              placeholder="0"
                            />
                            <span className="text-gray-500 font-medium">/</span>
                            <input
                              type="number"
                              value={player.fgAttempted}
                              onChange={(e) => handlePlayerChange(originalIndex, 'fgAttempted', parseInt(e.target.value) || 0)}
                              className="input-field text-sm w-16 text-center"
                              placeholder="0"
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              value={player.threeMade}
                              onChange={(e) => handlePlayerChange(originalIndex, 'threeMade', parseInt(e.target.value) || 0)}
                              className="input-field text-sm w-16 text-center"
                              placeholder="0"
                            />
                            <span className="text-gray-500 font-medium">/</span>
                            <input
                              type="number"
                              value={player.threeAttempted}
                              onChange={(e) => handlePlayerChange(originalIndex, 'threeAttempted', parseInt(e.target.value) || 0)}
                              className="input-field text-sm w-16 text-center"
                              placeholder="0"
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              value={player.ftMade}
                              onChange={(e) => handlePlayerChange(originalIndex, 'ftMade', parseInt(e.target.value) || 0)}
                              className="input-field text-sm w-16 text-center"
                              placeholder="0"
                            />
                            <span className="text-gray-500 font-medium">/</span>
                            <input
                              type="number"
                              value={player.ftAttempted}
                              onChange={(e) => handlePlayerChange(originalIndex, 'ftAttempted', parseInt(e.target.value) || 0)}
                              className="input-field text-sm w-16 text-center"
                              placeholder="0"
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Away Team Players */}
          <div className="card">
            <h3 className="text-md font-semibold text-gray-900 mb-4">Away Team Players ({gameData.awayTeam})</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[160px]">Player</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[140px]">Team</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">Grade</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">PTS</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">REB</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">AST</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">STL</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">BLK</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">FOULS</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[80px]">TO</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[140px]">FG</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[140px]">3PT</th>
                    <th className="px-4 py-4 text-left text-sm font-medium text-gray-700 uppercase tracking-wider min-w-[140px]">FT</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {awayPlayers.map((player, index) => {
                    const originalIndex = players.indexOf(player);
                    return (
                      <tr key={player.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={player.name}
                            onChange={(e) => handlePlayerChange(originalIndex, 'name', e.target.value)}
                            className="input-field text-base font-medium min-w-[140px]"
                            placeholder="Player Name"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={player.team}
                            onChange={(e) => handlePlayerChange(originalIndex, 'team', e.target.value)}
                            className="input-field text-base font-medium min-w-[120px]"
                            placeholder="Team"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={player.teammateGrade}
                            onChange={(e) => handlePlayerChange(originalIndex, 'teammateGrade', e.target.value)}
                            className="input-field text-sm w-16 text-center"
                            placeholder="Grade"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.points}
                            onChange={(e) => handlePlayerChange(originalIndex, 'points', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.rebounds}
                            onChange={(e) => handlePlayerChange(originalIndex, 'rebounds', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.assists}
                            onChange={(e) => handlePlayerChange(originalIndex, 'assists', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.steals}
                            onChange={(e) => handlePlayerChange(originalIndex, 'steals', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.blocks}
                            onChange={(e) => handlePlayerChange(originalIndex, 'blocks', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.fouls}
                            onChange={(e) => handlePlayerChange(originalIndex, 'fouls', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={player.turnovers}
                            onChange={(e) => handlePlayerChange(originalIndex, 'turnovers', parseInt(e.target.value) || 0)}
                            className="input-field text-sm w-20 text-center"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              value={player.fgMade}
                              onChange={(e) => handlePlayerChange(originalIndex, 'fgMade', parseInt(e.target.value) || 0)}
                              className="input-field text-sm w-16 text-center"
                              placeholder="0"
                            />
                            <span className="text-gray-500 font-medium">/</span>
                            <input
                              type="number"
                              value={player.fgAttempted}
                              onChange={(e) => handlePlayerChange(originalIndex, 'fgAttempted', parseInt(e.target.value) || 0)}
                              className="input-field text-sm w-16 text-center"
                              placeholder="0"
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              value={player.threeMade}
                              onChange={(e) => handlePlayerChange(originalIndex, 'threeMade', parseInt(e.target.value) || 0)}
                              className="input-field text-sm w-16 text-center"
                              placeholder="0"
                            />
                            <span className="text-gray-500 font-medium">/</span>
                            <input
                              type="number"
                              value={player.threeAttempted}
                              onChange={(e) => handlePlayerChange(originalIndex, 'threeAttempted', parseInt(e.target.value) || 0)}
                              className="input-field text-sm w-16 text-center"
                              placeholder="0"
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              value={player.ftMade}
                              onChange={(e) => handlePlayerChange(originalIndex, 'ftMade', parseInt(e.target.value) || 0)}
                              className="input-field text-sm w-16 text-center"
                              placeholder="0"
                            />
                            <span className="text-gray-500 font-medium">/</span>
                            <input
                              type="number"
                              value={player.ftAttempted}
                              onChange={(e) => handlePlayerChange(originalIndex, 'ftAttempted', parseInt(e.target.value) || 0)}
                              className="input-field text-sm w-16 text-center"
                              placeholder="0"
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Team Totals Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Home Team Totals ({gameData.homeTeam})
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-medium">Points:</span> {homeTeamTotals.points}
            </div>
            <div>
              <span className="font-medium">Rebounds:</span> {homeTeamTotals.rebounds}
            </div>
            <div>
              <span className="font-medium">Assists:</span> {homeTeamTotals.assists}
            </div>
            <div>
              <span className="font-medium">Steals:</span> {homeTeamTotals.steals}
            </div>
            <div>
              <span className="font-medium">Blocks:</span> {homeTeamTotals.blocks}
            </div>
            <div>
              <span className="font-medium">Fouls:</span> {homeTeamTotals.fouls}
            </div>
            <div>
              <span className="font-medium">Turnovers:</span> {homeTeamTotals.turnovers}
            </div>
            <div>
              <span className="font-medium">FG:</span> {homeTeamTotals.fgMade}/{homeTeamTotals.fgAttempted} 
              <span className="text-gray-500 ml-1">
                ({homeTeamTotals.fgAttempted > 0 ? ((homeTeamTotals.fgMade / homeTeamTotals.fgAttempted) * 100).toFixed(1) : 0}%)
              </span>
            </div>
            <div>
              <span className="font-medium">3PT:</span> {homeTeamTotals.threeMade}/{homeTeamTotals.threeAttempted}
              <span className="text-gray-500 ml-1">
                ({homeTeamTotals.threeAttempted > 0 ? ((homeTeamTotals.threeMade / homeTeamTotals.threeAttempted) * 100).toFixed(1) : 0}%)
              </span>
            </div>
            <div>
              <span className="font-medium">FT:</span> {homeTeamTotals.ftMade}/{homeTeamTotals.ftAttempted}
              <span className="text-gray-500 ml-1">
                ({homeTeamTotals.ftAttempted > 0 ? ((homeTeamTotals.ftMade / homeTeamTotals.ftAttempted) * 100).toFixed(1) : 0}%)
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Away Team Totals ({gameData.awayTeam})
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-medium">Points:</span> {awayTeamTotals.points}
            </div>
            <div>
              <span className="font-medium">Rebounds:</span> {awayTeamTotals.rebounds}
            </div>
            <div>
              <span className="font-medium">Assists:</span> {awayTeamTotals.assists}
            </div>
            <div>
              <span className="font-medium">Steals:</span> {awayTeamTotals.steals}
            </div>
            <div>
              <span className="font-medium">Blocks:</span> {awayTeamTotals.blocks}
            </div>
            <div>
              <span className="font-medium">Fouls:</span> {awayTeamTotals.fouls}
            </div>
            <div>
              <span className="font-medium">Turnovers:</span> {awayTeamTotals.turnovers}
            </div>
            <div>
              <span className="font-medium">FG:</span> {awayTeamTotals.fgMade}/{awayTeamTotals.fgAttempted}
              <span className="text-gray-500 ml-1">
                ({awayTeamTotals.fgAttempted > 0 ? ((awayTeamTotals.fgMade / awayTeamTotals.fgAttempted) * 100).toFixed(1) : 0}%)
              </span>
            </div>
            <div>
              <span className="font-medium">3PT:</span> {awayTeamTotals.threeMade}/{awayTeamTotals.threeAttempted}
              <span className="text-gray-500 ml-1">
                ({awayTeamTotals.threeAttempted > 0 ? ((awayTeamTotals.threeMade / awayTeamTotals.threeAttempted) * 100).toFixed(1) : 0}%)
              </span>
            </div>
            <div>
              <span className="font-medium">FT:</span> {awayTeamTotals.ftMade}/{awayTeamTotals.ftAttempted}
              <span className="text-gray-500 ml-1">
                ({awayTeamTotals.ftAttempted > 0 ? ((awayTeamTotals.ftMade / awayTeamTotals.ftAttempted) * 100).toFixed(1) : 0}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end space-x-4">
        <button
          onClick={handleCancel}
          className="btn-secondary flex items-center space-x-2"
        >
          <XMarkIcon className="w-4 h-4" />
          <span>Cancel</span>
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              <span>Saving...</span>
            </>
          ) : (
            <>
              <CheckIcon className="w-4 h-4" />
              <span>Save Changes</span>
            </>
          )}
        </button>
      </div>

      {/* Full Screen Image Modal */}
      {showFullScreenImage && gameData.screenshotUrl && (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center p-4 z-50">
          <div className="relative max-w-7xl max-h-full">
            <img
              src={gameData.screenshotUrl}
              alt="Original box score screenshot - Full Screen"
              className="w-full h-auto max-h-[90vh] object-contain"
            />
            <button
              onClick={() => setShowFullScreenImage(false)}
              className="absolute top-4 right-4 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-70 transition-all duration-200"
              title="Close full screen"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 text-white text-sm px-3 py-2 rounded">
              Press ESC or click X to close
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EditGame; 