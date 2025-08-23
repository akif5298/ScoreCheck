import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeftIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import toast from 'react-hot-toast';

interface PlayerStats {
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

interface GameData {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  date: string;
}

interface ReviewStatsProps {
  extractedData: {
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    players: PlayerStats[];
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
    };
    teamBTotals?: {
      points: number;
      rebounds: number;
      assists: number;
      steals: number;
      blocks: number;
      fouls: number;
      turnovers: number;
    };
  };
  originalImageUrl: string;
  originalFileName: string;
  onBack: () => void;
  onSave: () => void;
}

const ReviewStats: React.FC<ReviewStatsProps> = ({
  extractedData,
  originalImageUrl,
  originalFileName,
  onBack,
  onSave,
}) => {
  const [players, setPlayers] = useState<PlayerStats[]>(extractedData.players);
  
  // Calculate team totals based on actual team assignments from OCR parsing
  // Cap each team at 5 players maximum
  const maxPlayersPerTeam = 5;
  
  // Remove old team calculation logic - now using server-provided teams directly
  // const teamAPlayers = useMemo(() => {
  //   return players.filter((p) => p.team === 'Team A');
  // }, [players]);

  // const teamBPlayers = useMemo(() => {
  //   return players.filter((p) => p.team === 'Team B');
  // }, [players]);

  // const fallbackTeamAPlayers = useMemo(() => {
  //   if (teamAPlayers.length > 0 || teamBPlayers.length > 0) {
  //     return [];
  //   }
  //   const firstHalfCount = Math.ceil(players.length / 2);
  //   return players.slice(0, firstHalfCount);
  // }, [players, teamAPlayers, teamBPlayers, maxPlayersPerTeam]);

  // const fallbackTeamBPlayers = useMemo(() => {
  //   if (teamAPlayers.length > 0 || teamBPlayers.length > 0) {
  //     return [];
  //   }
  //   const firstHalfCount = Math.ceil(players.length / 2);
  //   return players.slice(firstHalfCount);
  // }, [players, teamAPlayers, teamBPlayers, maxPlayersPerTeam]);

  // const finalTeamAPlayers = teamAPlayers.length > 0 ? teamAPlayers : fallbackTeamAPlayers;
  // const finalTeamBPlayers = teamBPlayers.length > 0 ? teamBPlayers : fallbackTeamBPlayers;

  // const teamATotals = useMemo(() => ({
  //   points: finalTeamAPlayers.reduce((sum, player) => sum + player.points, 0),
  //   rebounds: finalTeamAPlayers.reduce((sum, player) => sum + player.rebounds, 0),
  //   assists: finalTeamAPlayers.reduce((sum, player) => sum + player.assists, 0),
  //   steals: finalTeamAPlayers.reduce((sum, player) => sum + player.steals, 0),
  //   blocks: finalTeamAPlayers.reduce((sum, player) => sum + player.blocks, 0),
  //   fouls: finalTeamAPlayers.reduce((sum, player) => sum + player.fouls, 0),
  //   turnovers: finalTeamAPlayers.reduce((sum, player) => sum + player.turnovers, 0),
  //   fgMade: finalTeamAPlayers.reduce((sum, player) => sum + player.fgMade, 0),
  //   fgAttempted: finalTeamAPlayers.reduce((sum, player) => sum + player.fgAttempted, 0),
  //   threeMade: finalTeamAPlayers.reduce((sum, player) => sum + player.threeMade, 0),
  //   threeAttempted: finalTeamAPlayers.reduce((sum, player) => sum + player.threeAttempted, 0),
  //   ftMade: finalTeamAPlayers.reduce((sum, player) => sum + player.ftMade, 0),
  //   ftAttempted: finalTeamAPlayers.reduce((sum, player) => sum + player.ftAttempted, 0),
  // }), [finalTeamAPlayers]);

  // const teamBTotals = useMemo(() => ({
  //   points: finalTeamBPlayers.reduce((sum, player) => sum + player.points, 0),
  //   rebounds: finalTeamBPlayers.reduce((sum, player) => sum + player.rebounds, 0),
  //   assists: finalTeamBPlayers.reduce((sum, player) => sum + player.assists, 0),
  //   steals: finalTeamBPlayers.reduce((sum, player) => sum + player.steals, 0),
  //   blocks: finalTeamBPlayers.reduce((sum, player) => sum + player.blocks, 0),
  //   fouls: finalTeamBPlayers.reduce((sum, player) => sum + player.fouls, 0),
  //   turnovers: finalTeamBPlayers.reduce((sum, player) => sum + player.turnovers, 0),
  //   fgMade: finalTeamBPlayers.reduce((sum, player) => sum + player.fgMade, 0),
  //   fgAttempted: finalTeamBPlayers.reduce((sum, player) => sum + player.fgAttempted, 0),
  //   threeMade: finalTeamBPlayers.reduce((sum, player) => sum + player.threeMade, 0),
  //   threeAttempted: finalTeamBPlayers.reduce((sum, player) => sum + player.threeAttempted, 0),
  //   ftMade: finalTeamBPlayers.reduce((sum, player) => sum + player.ftMade, 0),
  //   ftAttempted: finalTeamBPlayers.reduce((sum, player) => sum + player.ftAttempted, 0),
  // }), [finalTeamBPlayers]);

  // Function to generate short team name for display (only assigned players)
  // const generateShortTeamName = (teamPlayers: PlayerStats[]) => {
  //   if (!teamPlayers || teamPlayers.length === 0) return 'No Players';
  //   
  //   const names = teamPlayers.map(p => p.name).filter(Boolean);
  //   if (names.length === 0) return 'No Names';
  //   
  //   if (names.length === 1) return names[0];
  //   if (names.length === 2) return `${names[0]} + ${names[1]}`;
  //   if (names.length === 3) return `${names[0]} + ${names[1]} + ${names[2]}`;
  //   if (names.length === 4) return `${names[0]} + ${names[1]} + ${names[2]} + ${names[3]}`;
  //   return `${names[0]} + ${names[1]} + ${names[2]} + ${names[3]} + ${names[4]}`;
  // };

  const [gameData, setGameData] = useState<GameData>({
    homeTeam: extractedData.homeTeam || 'Team A',
    awayTeam: extractedData.awayTeam || 'Team B',
    homeScore: extractedData.teamATotals?.points || extractedData.homeScore || 0,
    awayScore: extractedData.teamBTotals?.points || extractedData.awayScore || 0,
    date: new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);
  
  // Add state for team quarter totals
  const [teamAQuarters, setTeamAQuarters] = useState<{ [key: string]: number }>(
    extractedData.teamAQuarters || { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
  );
  const [teamBQuarters, setTeamBQuarters] = useState<{ [key: string]: number }>(
    extractedData.teamBQuarters || { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
  );

  useEffect(() => {
    console.log('ReviewStats component mounted');
    console.log('Initial extractedData:', extractedData);
    console.log('Team A Totals:', extractedData.teamATotals);
    console.log('Team B Totals:', extractedData.teamBTotals);
    console.log('Initial players:', players);
    console.log('Initial gameData:', gameData);
    // console.log('Team A Players:', finalTeamAPlayers); // Removed
    // console.log('Team B Players:', finalTeamBPlayers); // Removed
    return () => {
      console.log('ReviewStats component unmounted');
    };
  }, [extractedData, players, gameData]); // Removed finalTeamAPlayers, finalTeamBPlayers

  // Debug logging to see what data we're working with
  useEffect(() => {
    console.log('🔍 ReviewStats Debug - Received data:', {
      players: players,
      extractedData: extractedData,
      gameData: gameData,
      teamAQuarters: teamAQuarters,
      teamBQuarters: teamBQuarters
    });
    
    if (players.length > 0) {
      console.log('🔍 First player sample:', {
        id: players[0].id,
        name: players[0].name,
        team: players[0].team,
        points: players[0].points,
        rebounds: players[0].rebounds,
        assists: players[0].assists
      });
    }
  }, [players, extractedData, gameData, teamAQuarters, teamBQuarters]);

  // Helper function to extract player number from ID if available
  const getPlayerNum = (id?: string) => {
    if (!id) return Number.POSITIVE_INFINITY;
    const parts = id.split('_');
    return parts.length >= 2 ? parseInt(parts[1] as string) : Number.POSITIVE_INFINITY;
  };

  // Group players by their actual team assignment from the server
  // This is more reliable than trying to parse IDs
  const homePlayers = players.filter(p => {
    // Check if player belongs to the home team
    return p.team === extractedData.homeTeam || p.team === 'Team A';
  }).sort((a, b) => {
    // Sort by original position if available, otherwise by name
    const aPos = getPlayerNum(a.id);
    const bPos = getPlayerNum(b.id);
    if (aPos !== Number.POSITIVE_INFINITY && bPos !== Number.POSITIVE_INFINITY) {
      return aPos - bPos;
    }
    return a.name.localeCompare(b.name);
  });

  const awayPlayers = players.filter(p => {
    // Check if player belongs to the away team
    return p.team === extractedData.awayTeam || p.team === 'Team B';
  }).sort((a, b) => {
    // Sort by original position if available, otherwise by name
    const aPos = getPlayerNum(a.id);
    const bPos = getPlayerNum(b.id);
    if (aPos !== Number.POSITIVE_INFINITY && bPos !== Number.POSITIVE_INFINITY) {
      return aPos - bPos;
    }
    return a.name.localeCompare(b.name);
  });
  
  // Use the actual team assignments
  const finalHomePlayers = homePlayers;
  const finalAwayPlayers = awayPlayers;
  
  // Use the team names from the extracted data, with fallbacks
  const homeTeamName = extractedData.homeTeam || 'Team A';
  const awayTeamName = extractedData.awayTeam || 'Team B';

  // Display lists: cap to 5 but do not move players across teams
  const displayHomePlayers = finalHomePlayers.slice(0, maxPlayersPerTeam);
  const displayAwayPlayers = finalAwayPlayers.slice(0, maxPlayersPerTeam);

  console.log('🔍 ReviewStats Team Assignment Debug:', {
    totalPlayers: players.length,
    homePlayers: homePlayers.length,
    awayPlayers: awayPlayers.length,
    finalHomePlayers: finalHomePlayers.length,
    finalAwayPlayers: finalAwayPlayers.length,
    displayHomePlayers: displayHomePlayers.length,
    displayAwayPlayers: displayAwayPlayers.length,
    homeTeamName: extractedData.homeTeam,
    awayTeamName: extractedData.awayTeam,
    playerTeams: players.map(p => ({ name: p.name, team: p.team }))
  });

  // Derive totals from the capped lists (memoized to prevent re-renders)
  const awayTeamTotals = useMemo(() => ({
    points: displayAwayPlayers.reduce((sum, p) => sum + p.points, 0),
    rebounds: displayAwayPlayers.reduce((sum, p) => sum + p.rebounds, 0),
    assists: displayAwayPlayers.reduce((sum, p) => sum + p.assists, 0),
    steals: displayAwayPlayers.reduce((sum, p) => sum + p.steals, 0),
    blocks: displayAwayPlayers.reduce((sum, p) => sum + p.blocks, 0),
    fouls: displayAwayPlayers.reduce((sum, p) => sum + p.fouls, 0),
    turnovers: displayAwayPlayers.reduce((sum, p) => sum + p.turnovers, 0),
    fgMade: displayAwayPlayers.reduce((sum, p) => sum + p.fgMade, 0),
    fgAttempted: displayAwayPlayers.reduce((sum, p) => sum + p.fgAttempted, 0),
    threeMade: displayAwayPlayers.reduce((sum, p) => sum + p.threeMade, 0),
    threeAttempted: displayAwayPlayers.reduce((sum, p) => sum + p.threeAttempted, 0),
    ftMade: displayAwayPlayers.reduce((sum, p) => sum + p.ftMade, 0),
    ftAttempted: displayAwayPlayers.reduce((sum, p) => sum + p.ftAttempted, 0),
  }), [displayAwayPlayers]);

  const homeTeamTotals = useMemo(() => ({
    points: displayHomePlayers.reduce((sum, p) => sum + p.points, 0),
    rebounds: displayHomePlayers.reduce((sum, p) => sum + p.rebounds, 0),
    assists: displayHomePlayers.reduce((sum, p) => sum + p.assists, 0),
    steals: displayHomePlayers.reduce((sum, p) => sum + p.steals, 0),
    blocks: displayHomePlayers.reduce((sum, p) => sum + p.blocks, 0),
    fouls: displayHomePlayers.reduce((sum, p) => sum + p.fouls, 0),
    turnovers: displayHomePlayers.reduce((sum, p) => sum + p.turnovers, 0),
    fgMade: displayHomePlayers.reduce((sum, p) => sum + p.fgMade, 0),
    fgAttempted: displayHomePlayers.reduce((sum, p) => sum + p.fgAttempted, 0),
    threeMade: displayHomePlayers.reduce((sum, p) => sum + p.threeMade, 0),
    threeAttempted: displayHomePlayers.reduce((sum, p) => sum + p.threeAttempted, 0),
    ftMade: displayHomePlayers.reduce((sum, p) => sum + p.ftMade, 0),
    ftAttempted: displayHomePlayers.reduce((sum, p) => sum + p.ftAttempted, 0),
  }), [displayHomePlayers]);

  // Do not overwrite server-provided custom names here

  const handlePlayerChange = (index: number, field: keyof PlayerStats, value: string | number) => {
    const updatedPlayers = [...players];
    updatedPlayers[index] = {
      ...updatedPlayers[index],
      [field]: value,
    };
    setPlayers(updatedPlayers);
  };

  const handleGameDataChange = (field: keyof GameData, value: string | number) => {
    setGameData({
      ...gameData,
      [field]: value,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await axios.post('/api/screenshots/save', {
        gameData: {
          ...gameData,
          teamAQuarters,
          teamBQuarters
        },
        playersData: players,
        originalImageBuffer: originalImageUrl,
      });

      if (response.data.success) {
        toast.success('Box score saved successfully!');
        onSave();
      } else {
        throw new Error(response.data.error || 'Save failed');
      }
    } catch (error: any) {
      console.error('Save error:', error);
      toast.error(error.response?.data?.error || 'Failed to save box score');
    } finally {
      setSaving(false);
    }
  };

  // Remove client-side reassignment to avoid mixing teams
  // (keep players' server-assigned teams as-is)

  // Debug the final display teams
  useEffect(() => {
    console.log('🎯 Final display teams debug:', {
      displayHomePlayers: displayHomePlayers.map(p => ({ name: p.name, team: p.team, id: p.id })),
      displayAwayPlayers: displayAwayPlayers.map(p => ({ name: p.name, team: p.team, id: p.id }))
    });
  }, [displayHomePlayers, displayAwayPlayers]);

  // Debug logging
  useEffect(() => {
    console.log('ReviewStats calculated data updated:');
    console.log('Current players length:', players.length);
    console.log('Away team totals:', awayTeamTotals);
    console.log('Home team totals:', homeTeamTotals);
    console.log('Away team players:', displayAwayPlayers);
    console.log('Home team players:', displayHomePlayers);
  }, [players, awayTeamTotals, homeTeamTotals, displayAwayPlayers, displayHomePlayers]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBack}
            className="p-2 text-gray-600 hover:text-gray-900 transition-colors duration-200"
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Review Box Score</h1>
            <p className="text-gray-600">Review and edit the extracted data before saving</p>
          </div>
        </div>
        <div className="text-sm text-gray-500">
          File: {originalFileName}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cropped Image Preview */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Cropped Box Score</h2>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <img
              src={originalImageUrl}
              alt="Box Score"
              className="w-full h-auto object-contain"
            />
          </div>
        </div>

        {/* Game Information */}
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
                  placeholder={homeTeamName}
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
                  placeholder={awayTeamName}
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
            {/* Team Quarter Totals */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Team A Quarter Totals
                </label>
                <div className="flex space-x-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">Q1:</span>
                    <input
                      type="number"
                      value={teamAQuarters.Q1}
                      onChange={(e) => setTeamAQuarters({ ...teamAQuarters, Q1: parseInt(e.target.value) || 0 })}
                      className="input-field text-sm w-16 text-center"
                      placeholder="0"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">Q2:</span>
                    <input
                      type="number"
                      value={teamAQuarters.Q2}
                      onChange={(e) => setTeamAQuarters({ ...teamAQuarters, Q2: parseInt(e.target.value) || 0 })}
                      className="input-field text-sm w-16 text-center"
                      placeholder="0"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">Q3:</span>
                    <input
                      type="number"
                      value={teamAQuarters.Q3}
                      onChange={(e) => setTeamAQuarters({ ...teamAQuarters, Q3: parseInt(e.target.value) || 0 })}
                      className="input-field text-sm w-16 text-center"
                      placeholder="0"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">Q4:</span>
                    <input
                      type="number"
                      value={teamAQuarters.Q4}
                      onChange={(e) => setTeamAQuarters({ ...teamAQuarters, Q4: parseInt(e.target.value) || 0 })}
                      className="input-field text-sm w-16 text-center"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Team B Quarter Totals
                </label>
                <div className="flex space-x-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">Q1:</span>
                    <input
                      type="number"
                      value={teamBQuarters.Q1}
                      onChange={(e) => setTeamBQuarters({ ...teamBQuarters, Q1: parseInt(e.target.value) || 0 })}
                      className="input-field text-sm w-16 text-center"
                      placeholder="0"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">Q2:</span>
                    <input
                      type="number"
                      value={teamBQuarters.Q2}
                      onChange={(e) => setTeamBQuarters({ ...teamBQuarters, Q2: parseInt(e.target.value) || 0 })}
                      className="input-field text-sm w-16 text-center"
                      placeholder="0"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">Q3:</span>
                    <input
                      type="number"
                      value={teamBQuarters.Q3}
                      onChange={(e) => setTeamBQuarters({ ...teamBQuarters, Q3: parseInt(e.target.value) || 0 })}
                      className="input-field text-sm w-16 text-center"
                      placeholder="0"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">Q4:</span>
                    <input
                      type="number"
                      value={teamBQuarters.Q4}
                      onChange={(e) => setTeamBQuarters({ ...teamBQuarters, Q4: parseInt(e.target.value) || 0 })}
                      className="input-field text-sm w-16 text-center"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Player Statistics split by team */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Player Statistics</h2>
        <div className="space-y-6">
          {/* Home Team Players */}
          <div className="card">
            <h3 className="text-md font-semibold text-gray-900 mb-4">Home Team Players ({homeTeamName})</h3>
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
                  {displayHomePlayers.map((player) => {
                    const originalIndex = players.indexOf(player);
                    return (
                      <tr key={originalIndex} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={player.name}
                              onChange={(e) => handlePlayerChange(originalIndex, 'name', e.target.value)}
                              className="input-field text-base font-medium min-w-[140px]"
                              placeholder="Player Name"
                            />
                            {player.name.startsWith('P') && player.name.length <= 3 && (
                              <div className="text-xs text-gray-500 font-mono">Player ID: {player.name}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            readOnly
                            value={player.team}
                            className="input-field text-base font-medium min-w-[120px] bg-gray-100"
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
            <h3 className="text-md font-semibold text-gray-900 mb-4">Away Team Players ({awayTeamName})</h3>
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
                  {displayAwayPlayers.map((player) => {
                    const originalIndex = players.indexOf(player);
                    return (
                      <tr key={originalIndex} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={player.name}
                              onChange={(e) => handlePlayerChange(originalIndex, 'name', e.target.value)}
                              className="input-field text-base font-medium min-w-[140px]"
                              placeholder="Player Name"
                            />
                            {player.name.startsWith('P') && player.name.length <= 3 && (
                              <div className="text-xs text-gray-500 font-mono">Player ID: {player.name}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            readOnly
                            value={player.team}
                            className="input-field text-base font-medium min-w-[120px] bg-gray-100"
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


      {players && players.length > 0 ? (
          <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Home Team Totals
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
              Away Team Totals
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
        </div>
      ) : (
        <div className="card">
          <div className="text-center py-8">
            <p className="text-gray-500">No player data available to calculate team totals.</p>
            <p className="text-sm text-gray-400 mt-2">Please ensure the image was processed correctly.</p>
          </div>
        </div>
      )}



      {/* Action Buttons */}
      <div className="flex justify-end space-x-4">
        <button
          onClick={onBack}
          className="btn-secondary flex items-center space-x-2"
        >
          <XMarkIcon className="w-4 h-4" />
          <span>Back to Upload</span>
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
              <span>Save to Database</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default ReviewStats;
