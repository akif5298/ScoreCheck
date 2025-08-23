import React, { useState, useEffect } from 'react';
import { XMarkIcon, CheckIcon } from '@heroicons/react/24/outline';

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
  originalPlayerId?: string; // Optional: for tracking original P1, P2, P3, etc.
}

interface PlayerNameAssignmentProps {
  players: PlayerStats[];
  onComplete: (updatedPlayers: PlayerStats[]) => void;
  onClose: () => void;
}

const AVAILABLE_NAMES = [
  'Akif', 'Abdul', 'Anis', 'Ankit', 'Nillan', 'Ikroop', 'TV', 'Kashif', 'Dylan'
];

// Helper function to get position from player ID
const getPositionFromPlayerId = (playerId: string): string => {
  // Extract the number from P1, P2, P3, etc.
  const match = playerId.match(/P(\d+)/);
  if (!match) return 'Unknown';
  
  const playerNumber = parseInt(match[1]);
  
  // Map player numbers to positions
  switch (playerNumber) {
    case 1:
    case 6:
      return 'PG'; // Point Guard
    case 2:
    case 7:
      return 'SG'; // Shooting Guard
    case 3:
    case 8:
      return 'SF'; // Small Forward
    case 4:
    case 9:
      return 'PF'; // Power Forward
    case 5:
    case 10:
      return 'C';  // Center
    default:
      return 'Unknown';
  }
};

// Helper function to check if a player is an AI player
const isAIPlayer = (name: string): boolean => {
  const aiKeywords = ['ai', 'al', 'player'];
  const lowerName = name.toLowerCase();
  return aiKeywords.some(keyword => lowerName.includes(keyword));
};

const PlayerNameAssignment: React.FC<PlayerNameAssignmentProps> = ({
  players,
  onComplete,
  onClose
}) => {
  const [playerAssignments, setPlayerAssignments] = useState<{ [key: string]: string }>({});
  const [assignedNames, setAssignedNames] = useState<Set<string>>(new Set());

  console.log('🔍 PlayerNameAssignment Debug:', {
    totalPlayers: players.length,
    players: players.map((p, i) => ({ index: i, name: p.name, team: p.team }))
  });
  
  // Debug: Log each player individually to see if any are missing
  console.log('🔍 INDIVIDUAL PLAYER CHECK:');
  players.forEach((player, index) => {
    console.log(`  Player ${index + 1}: Name="${player.name}", Team="${player.team}", Points=${player.points}`);
  });

  // Initialize assignments with existing names or player IDs
  useEffect(() => {
    const initialAssignments: { [key: string]: string } = {};
    const usedNames = new Set<string>();

    console.log('🔍 Processing players for assignment:', players.length, 'players');

    players.forEach((player, index) => {
      const playerId = `P${index + 1}`;
      if (player.name && AVAILABLE_NAMES.includes(player.name)) {
        initialAssignments[playerId] = player.name;
        usedNames.add(player.name);
      } else {
        initialAssignments[playerId] = playerId; // Keep player ID if no valid name
      }
      
      console.log(`🔍 Player ${index + 1}:`, { 
        originalName: player.name, 
        assignedName: initialAssignments[playerId], 
        team: player.team 
      });
    });

    setPlayerAssignments(initialAssignments);
    setAssignedNames(usedNames);
    
    console.log('🔍 Initial assignments:', initialAssignments);
    console.log('🔍 Used names:', Array.from(usedNames));
  }, [players]);

  const handleNameAssignment = (playerId: string, name: string) => {
    const previousName = playerAssignments[playerId];
    
    // Remove previous name from assigned names
    if (previousName && AVAILABLE_NAMES.includes(previousName)) {
      const newAssignedNames = new Set(assignedNames);
      newAssignedNames.delete(previousName);
      setAssignedNames(newAssignedNames);
    }

    // Add new name to assigned names
    if (name && AVAILABLE_NAMES.includes(name)) {
      const newAssignedNames = new Set(assignedNames);
      newAssignedNames.add(name);
      setAssignedNames(newAssignedNames);
    }

    setPlayerAssignments({
      ...playerAssignments,
      [playerId]: name
    });
  };

  const handleComplete = () => {
    // Update players with assigned names but PRESERVE original OCR team detection and player IDs
    const updatedPlayers = players.map((player, index) => {
      const playerId = `P${index + 1}`;
      const assignedName = playerAssignments[playerId];
      
      // Use the assigned name if it's a custom name, otherwise keep original
      const finalName = AVAILABLE_NAMES.includes(assignedName) ? assignedName : player.name;
      
      // IMPORTANT: Keep the original OCR team detection instead of forcing position-based assignment
      // This preserves the actual team relationships detected by the OCR
      const team = player.team; // Keep original team from OCR
      
      return {
        ...player,
        name: finalName,
        team: team, // Preserve OCR team detection
        originalPlayerId: playerId // Preserve the original player ID for position mapping
      };
    });

    console.log('🔍 PlayerNameAssignment: Updated players with team assignments:', updatedPlayers.map(p => ({ name: p.name, team: p.team })));

    // Generate custom team names ONLY for teams that have assigned custom names
    // Get unique team names from OCR detection (could be "Team A", "Team B", or custom names)
    const uniqueTeams = [...new Set(updatedPlayers.map(p => p.team))];
    console.log('🔍 Unique teams detected by OCR:', uniqueTeams);
    
        // Generate custom team names only for teams that have custom names assigned
    const teamCustomNames: { [key: string]: string } = {};
    
    uniqueTeams.forEach(teamName => {
      const teamPlayers = updatedPlayers.filter(p => p.team === teamName);
      
      // Check if this team has any custom names assigned
      const hasCustomNames = teamPlayers.some(p => AVAILABLE_NAMES.includes(p.name));
      
      if (hasCustomNames) {
        // This team has custom names - generate position-based team name
        const sortedTeamPlayers = teamPlayers.sort((a, b) => {
          const aId = (a as any).originalPlayerId || 'Unknown';
          const bId = (b as any).originalPlayerId || 'Unknown';
          
          // Extract numbers from P1, P2, P3, etc.
          const aMatch = aId.match(/P(\d+)/);
          const bMatch = bId.match(/P(\d+)/);
          
          if (aMatch && bMatch) {
            return parseInt(aMatch[1]) - parseInt(bMatch[1]);
          }
          return 0;
        });
        
        // Generate team name based on positions
        const teamNameParts = sortedTeamPlayers.map((player) => {
          // Use the preserved original player ID for position mapping
          const playerId = (player as any).originalPlayerId || 'Unknown';
          const position = getPositionFromPlayerId(playerId);
          
          // Check if this is a custom name from assignment
          if (AVAILABLE_NAMES.includes(player.name)) {
            return `${player.name} (${position})`;
          }
          // Check if this is an AI player
          else if (isAIPlayer(player.name)) {
            return `AI (${position})`;
          }
          // Otherwise it's a random/unassigned player
          else {
            return `Random (${position})`;
          }
        });
        
        // Join all position-based names
        teamCustomNames[teamName] = teamNameParts.join(' + ');
        
        console.log(`🔍 Team ${teamName} has custom names - generating position-based name:`, {
          teamPlayers: teamPlayers.map(p => ({ name: p.name, isCustom: AVAILABLE_NAMES.includes(p.name), isAI: isAIPlayer(p.name) })),
          sortedTeamPlayers: sortedTeamPlayers.map(p => ({ name: p.name, isCustom: AVAILABLE_NAMES.includes(p.name), isAI: isAIPlayer(p.name) })),
          teamNameParts: teamNameParts,
          finalTeamName: teamCustomNames[teamName]
        });
      } else {
        // This team has no custom names - keep original team name
        teamCustomNames[teamName] = teamName;
        
        console.log(`🔍 Team ${teamName} has no custom names - keeping original name:`, {
          teamPlayers: teamPlayers.map(p => ({ name: p.name, isCustom: AVAILABLE_NAMES.includes(p.name), isAI: isAIPlayer(p.name) })),
          finalTeamName: teamCustomNames[teamName]
        });
      }
    });
    
    console.log('🔍 Generated custom team names:', teamCustomNames);

    // Now apply the custom team names to the players
    const playersWithCustomTeams = updatedPlayers.map(player => ({
      ...player,
      team: teamCustomNames[player.team] || player.team // Use custom name if available, otherwise keep original
    }));

    console.log('🔍 Final players with custom team names:', playersWithCustomTeams.map(p => ({ name: p.name, team: p.team })));

    onComplete(playersWithCustomTeams);
  };

  const getAvailableNamesForPlayer = (currentPlayerId: string) => {
    const currentAssignment = playerAssignments[currentPlayerId];
    return AVAILABLE_NAMES.filter(name => {
      // Include names that are either unassigned or assigned to this player
      return !assignedNames.has(name) || name === currentAssignment;
    });
  };

  const isAssignmentValid = () => {
    // Check if all players have either a valid name or keep their player ID
    return players.every((_, index) => {
      const playerId = `P${index + 1}`;
      const assignment = playerAssignments[playerId];
      return assignment === playerId || AVAILABLE_NAMES.includes(assignment);
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-7xl w-full max-h-[95vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Assign Player Names</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(95vh-140px)]">
          {/* Scanned Player IDs Section - Horizontal Layout */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Scanned Player IDs</h3>
            <div className="grid grid-cols-5 gap-4">
              {players.map((player, index) => {
                const playerId = `P${index + 1}`;
                const currentAssignment = playerAssignments[playerId];
                const isAssigned = AVAILABLE_NAMES.includes(currentAssignment);
                
                return (
                  <div
                    key={playerId}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      isAssigned 
                        ? 'border-green-200 bg-green-50' 
                        : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                                         <div className="flex items-center justify-between mb-2">
                       <div className="text-center">
                         <div className="font-mono text-lg font-bold text-gray-700 mb-1">
                           {playerId}
                         </div>
                         <div className="text-sm text-gray-500 font-medium">
                           Scanned: {player.name}
                         </div>
                       </div>
                       {isAssigned && (
                         <CheckIcon className="h-5 w-5 text-green-600" />
                       )}
                     </div>
                    
                    {/* Player Stats Preview - Horizontal Layout */}
                    <div className="text-sm text-gray-600">
                      <div className="grid grid-cols-2 gap-1">
                        <div className="flex justify-between">
                          <span>PTS:</span>
                          <span className="font-medium">{player.points}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>REB:</span>
                          <span className="font-medium">{player.rebounds}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>AST:</span>
                          <span className="font-medium">{player.assists}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Grade:</span>
                          <span className="font-medium">{player.teammateGrade}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Available Names Section - Horizontal Layout */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Available Names</h3>
            <div className="grid grid-cols-9 gap-3">
              {AVAILABLE_NAMES.map((name) => {
                const isAssigned = assignedNames.has(name);
                const assignedTo = Object.entries(playerAssignments).find(([_, assignedName]) => assignedName === name);
                
                return (
                  <div
                    key={name}
                    className={`p-3 rounded-lg border-2 transition-all text-center ${
                      isAssigned 
                        ? 'border-blue-200 bg-blue-50' 
                        : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="font-semibold text-gray-700 mb-1">
                      {name}
                    </div>
                    
                    {isAssigned ? (
                      <div className="text-xs text-blue-600">
                        → {assignedTo?.[0]}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500">
                        Available
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Assignment Controls */}
          <div className="mt-8 p-4 bg-gray-50 rounded-lg">
            <h4 className="text-md font-semibold text-gray-900 mb-3">Quick Assignment</h4>
            <div className="grid grid-cols-5 gap-4">
              {players.map((player, index) => {
                const playerId = `P${index + 1}`;
                const currentAssignment = playerAssignments[playerId];
                
                return (
                  <div key={playerId} className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700 text-center">
                      {playerId}
                    </label>
                    <select
                      value={currentAssignment}
                      onChange={(e) => handleNameAssignment(playerId, e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value={playerId}>{playerId}</option>
                      {getAvailableNamesForPlayer(playerId).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-600">
            {assignedNames.size} of {AVAILABLE_NAMES.length} names assigned
          </div>
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleComplete}
              disabled={!isAssignmentValid()}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Continue to Review
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerNameAssignment;
