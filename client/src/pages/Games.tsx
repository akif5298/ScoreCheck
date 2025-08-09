import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { CalendarIcon, ClockIcon, UsersIcon } from '@heroicons/react/outline';

interface Game {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  players: any[];
  teams: any[];
}

const Games: React.FC = () => {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  useEffect(() => {
    fetchGames();
  }, []);

  const fetchGames = async () => {
    try {
      const response = await axios.get('/api/screenshots/games');
      if (response.data.success) {
        setGames(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching games:', error);
      toast.error('Failed to load games');
      
      // Set mock data for demo
      setGames([
        {
          id: '1',
          date: new Date().toISOString(),
          homeTeam: 'Lakers',
          awayTeam: 'Celtics',
          homeScore: 108,
          awayScore: 95,
          players: [
            { name: 'LeBron James', points: 25, rebounds: 8, assists: 10, team: 'Lakers' },
            { name: 'Anthony Davis', points: 22, rebounds: 12, assists: 3, team: 'Lakers' },
            { name: 'Jayson Tatum', points: 28, rebounds: 6, assists: 4, team: 'Celtics' },
          ],
          teams: [
            { name: 'Lakers', points: 108, rebounds: 42, assists: 24, isHome: true },
            { name: 'Celtics', points: 95, rebounds: 38, assists: 18, isHome: false },
          ],
        },
        {
          id: '2',
          date: new Date(Date.now() - 86400000).toISOString(),
          homeTeam: 'Warriors',
          awayTeam: 'Bulls',
          homeScore: 112,
          awayScore: 98,
          players: [
            { name: 'Stephen Curry', points: 32, rebounds: 5, assists: 8, team: 'Warriors' },
            { name: 'Draymond Green', points: 8, rebounds: 11, assists: 7, team: 'Warriors' },
            { name: 'Zach LaVine', points: 24, rebounds: 4, assists: 5, team: 'Bulls' },
          ],
          teams: [
            { name: 'Warriors', points: 112, rebounds: 45, assists: 28, isHome: true },
            { name: 'Bulls', points: 98, rebounds: 36, assists: 20, isHome: false },
          ],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const getWinner = (game: Game) => {
    return game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam;
  };

  const getLoser = (game: Game) => {
    return game.homeScore > game.awayScore ? game.awayTeam : game.homeTeam;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Game History</h1>
        <p className="text-gray-600">Browse all your uploaded NBA 2K25 games</p>
      </div>

      {/* Games Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {games.map((game) => (
          <div key={game.id} className="card hover:shadow-md transition-shadow duration-200 cursor-pointer" onClick={() => setSelectedGame(game)}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <CalendarIcon className="w-5 h-5 text-gray-400" />
                <span className="text-sm text-gray-600">
                  {new Date(game.date).toLocaleDateString()}
                </span>
              </div>
              <div className="text-sm text-gray-500">
                {new Date(game.date).toLocaleTimeString()}
              </div>
            </div>

            {/* Teams and Score */}
            <div className="text-center mb-4">
              <div className="flex items-center justify-center space-x-4">
                <div className="text-center">
                  <h3 className="font-semibold text-gray-900">{game.homeTeam}</h3>
                  <p className="text-2xl font-bold text-gray-900">{game.homeScore}</p>
                </div>
                <div className="text-gray-400 font-medium">vs</div>
                <div className="text-center">
                  <h3 className="font-semibold text-gray-900">{game.awayTeam}</h3>
                  <p className="text-2xl font-bold text-gray-900">{game.awayScore}</p>
                </div>
              </div>
              
              <div className="mt-2">
                <span className="text-sm font-medium text-green-600">
                  {getWinner(game)} won
                </span>
              </div>
            </div>

            {/* Game Stats */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center space-x-2">
                <UsersIcon className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">
                  {game.players?.length || 0} players
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <ClockIcon className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600">
                  {game.teams?.length || 0} teams
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Game Details Modal */}
      {selectedGame && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Game Details</h2>
                <button
                  onClick={() => setSelectedGame(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Game Info */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <CalendarIcon className="w-5 h-5 text-gray-400" />
                    <span className="text-gray-600">
                      {new Date(selectedGame.date).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500">
                    {new Date(selectedGame.date).toLocaleTimeString()}
                  </div>
                </div>

                <div className="text-center mb-6">
                  <div className="flex items-center justify-center space-x-8">
                    <div className="text-center">
                      <h3 className="text-xl font-semibold text-gray-900">{selectedGame.homeTeam}</h3>
                      <p className="text-4xl font-bold text-gray-900">{selectedGame.homeScore}</p>
                    </div>
                    <div className="text-gray-400 text-xl font-medium">vs</div>
                    <div className="text-center">
                      <h3 className="text-xl font-semibold text-gray-900">{selectedGame.awayTeam}</h3>
                      <p className="text-4xl font-bold text-gray-900">{selectedGame.awayScore}</p>
                    </div>
                  </div>
                  
                  <div className="mt-4">
                    <span className="text-lg font-medium text-green-600">
                      {getWinner(selectedGame)} defeated {getLoser(selectedGame)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Team Stats */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Statistics</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {selectedGame.teams?.map((team, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-4">
                      <h4 className="font-semibold text-gray-900 mb-3">{team.name}</h4>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-gray-600">Points</p>
                          <p className="font-semibold text-gray-900">{team.points}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Rebounds</p>
                          <p className="font-semibold text-gray-900">{team.rebounds}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Assists</p>
                          <p className="font-semibold text-gray-900">{team.assists}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Player Stats */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Player Statistics</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Player
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Team
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Points
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Rebounds
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Assists
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {selectedGame.players?.map((player, index) => (
                        <tr key={index}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{player.name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{player.team}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{player.points}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{player.rebounds}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{player.assists}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {games.length === 0 && (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CalendarIcon className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No games yet</h3>
          <p className="text-gray-600 mb-6">
            Upload your first box score screenshot to start tracking your games.
          </p>
          <button className="btn-primary">
            Upload Screenshot
          </button>
        </div>
      )}
    </div>
  );
};

export default Games;
