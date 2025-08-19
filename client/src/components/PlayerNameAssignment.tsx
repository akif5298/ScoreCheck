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
}

interface PlayerNameAssignmentProps {
  players: PlayerStats[];
  onComplete: (updatedPlayers: PlayerStats[]) => void;
  onClose: () => void;
}

const AVAILABLE_NAMES = [
  'Akif', 'Abdul', 'Anis', 'Ankit', 'Nillan', 'Ikroop', 'TV', 'Kashif', 'Dylan'
];

const PlayerNameAssignment: React.FC<PlayerNameAssignmentProps> = ({
  players,
  onComplete,
  onClose
}) => {
  const [playerAssignments, setPlayerAssignments] = useState<{ [key: string]: string }>({});
  const [assignedNames, setAssignedNames] = useState<Set<string>>(new Set());

  // Initialize assignments with existing names or player IDs
  useEffect(() => {
    const initialAssignments: { [key: string]: string } = {};
    const usedNames = new Set<string>();

    players.forEach((player, index) => {
      const playerId = `P${index + 1}`;
      if (player.name && AVAILABLE_NAMES.includes(player.name)) {
        initialAssignments[playerId] = player.name;
        usedNames.add(player.name);
      } else {
        initialAssignments[playerId] = playerId; // Keep player ID if no valid name
      }
    });

    setPlayerAssignments(initialAssignments);
    setAssignedNames(usedNames);
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
    // Update players with assigned names AND preserve team assignments
    const updatedPlayers = players.map((player, index) => {
      const playerId = `P${index + 1}`;
      const assignedName = playerAssignments[playerId];
      
      // Determine team based on player position (P1-P5 = Team A, P6-P10 = Team B)
      const team = index < 5 ? 'Team A' : 'Team B';
      
      // Use the assigned name if it's a custom name, otherwise keep original
      const finalName = AVAILABLE_NAMES.includes(assignedName) ? assignedName : player.name;
      
      // IMPORTANT: Preserve the original player ID from OCR service for position mapping
      // The backend needs the original ID format (e.g., "IMG_123_1_A") to determine positions
      return {
        ...player,
        name: finalName,
        team: team, // ✅ Preserve team assignment based on position
        // Keep original id field intact for position mapping
      };
    });

    console.log('🔍 PlayerNameAssignment: Updated players with team assignments:', updatedPlayers.map(p => ({ name: p.name, team: p.team })));

    // Generate custom team names based on the updated players
    // This will be handled in the parent component after assignment
    onComplete(updatedPlayers);
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
