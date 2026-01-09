import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { CalendarIcon, ClockIcon, UsersIcon, PencilIcon } from '@heroicons/react/24/outline';

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
  const navigate = useNavigate();
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
      toast.success('Loaded demo data');
      
      // Set mock data for demo - matches Dashboard recent games
      setGames([
        {
          id: '1',
          date: new Date(Date.now() - 86400000).toISOString(),
          homeTeam: 'Team C',
          awayTeam: 'Team D',
          homeScore: 108,
          awayScore: 95,
          players: [
            { name: 'Akif', points: 28, rebounds: 9, assists: 7, steals: 3, blocks: 2, fgMade: 11, fgAttempted: 20, threeMade: 4, threeAttempted: 8, ftMade: 2, ftAttempted: 3, turnovers: 2, fouls: 2, team: 'Team C' },
            { name: 'Ikroop', points: 22, rebounds: 6, assists: 4, steals: 1, blocks: 1, fgMade: 9, fgAttempted: 16, threeMade: 2, threeAttempted: 5, ftMade: 2, ftAttempted: 2, turnovers: 3, fouls: 3, team: 'Team C' },
            { name: 'Dylan', points: 18, rebounds: 5, assists: 3, steals: 2, blocks: 0, fgMade: 7, fgAttempted: 14, threeMade: 3, threeAttempted: 6, ftMade: 1, ftAttempted: 2, turnovers: 2, fouls: 2, team: 'Team C' },
            { name: 'Ankit', points: 16, rebounds: 4, assists: 2, steals: 1, blocks: 0, fgMade: 6, fgAttempted: 12, threeMade: 1, threeAttempted: 4, ftMade: 3, ftAttempted: 4, turnovers: 1, fouls: 1, team: 'Team C' },
            { name: 'TV', points: 24, rebounds: 3, assists: 1, steals: 0, blocks: 0, fgMade: 9, fgAttempted: 15, threeMade: 5, threeAttempted: 9, ftMade: 1, ftAttempted: 1, turnovers: 1, fouls: 2, team: 'Team C' },
            { name: 'Anis', points: 32, rebounds: 8, assists: 9, steals: 4, blocks: 1, fgMade: 12, fgAttempted: 22, threeMade: 3, threeAttempted: 7, ftMade: 5, ftAttempted: 6, turnovers: 4, fouls: 3, team: 'Team D' },
            { name: 'Nillan', points: 20, rebounds: 7, assists: 5, steals: 2, blocks: 1, fgMade: 8, fgAttempted: 15, threeMade: 2, threeAttempted: 5, ftMade: 2, ftAttempted: 3, turnovers: 2, fouls: 2, team: 'Team D' },
            { name: 'Kashif', points: 18, rebounds: 5, assists: 4, steals: 1, blocks: 0, fgMade: 7, fgAttempted: 13, threeMade: 2, threeAttempted: 4, ftMade: 2, ftAttempted: 2, turnovers: 3, fouls: 2, team: 'Team D' },
            { name: 'Abdul', points: 15, rebounds: 4, assists: 3, steals: 1, blocks: 0, fgMade: 6, fgAttempted: 11, threeMade: 1, threeAttempted: 3, ftMade: 2, ftAttempted: 3, turnovers: 2, fouls: 1, team: 'Team D' },
            { name: 'Player 10', points: 10, rebounds: 3, assists: 2, steals: 0, blocks: 0, fgMade: 4, fgAttempted: 8, threeMade: 1, threeAttempted: 3, ftMade: 1, ftAttempted: 2, turnovers: 1, fouls: 1, team: 'Team D' },
          ],
          teams: [
            { name: 'Team C', points: 108, rebounds: 27, assists: 19, isHome: true },
            { name: 'Team D', points: 95, rebounds: 27, assists: 23, isHome: false },
          ],
        },
        {
          id: '2',
          date: new Date(Date.now() - 172800000).toISOString(),
          homeTeam: 'Team E',
          awayTeam: 'Team C',
          homeScore: 125,
          awayScore: 98,
          players: [
            { name: 'Abdul', points: 42, rebounds: 8, assists: 5, steals: 2, blocks: 1, fgMade: 16, fgAttempted: 28, threeMade: 6, threeAttempted: 12, ftMade: 4, ftAttempted: 5, turnovers: 3, fouls: 2, team: 'Team E' },
            { name: 'Player 2', points: 24, rebounds: 6, assists: 4, steals: 1, blocks: 1, fgMade: 9, fgAttempted: 17, threeMade: 3, threeAttempted: 7, ftMade: 3, ftAttempted: 4, turnovers: 2, fouls: 2, team: 'Team E' },
            { name: 'Player 3', points: 20, rebounds: 5, assists: 3, steals: 2, blocks: 0, fgMade: 8, fgAttempted: 14, threeMade: 2, threeAttempted: 5, ftMade: 2, ftAttempted: 3, turnovers: 2, fouls: 3, team: 'Team E' },
            { name: 'Player 4', points: 18, rebounds: 4, assists: 2, steals: 1, blocks: 0, fgMade: 7, fgAttempted: 13, threeMade: 2, threeAttempted: 4, ftMade: 2, ftAttempted: 2, turnovers: 1, fouls: 1, team: 'Team E' },
            { name: 'Player 5', points: 21, rebounds: 3, assists: 1, steals: 0, blocks: 0, fgMade: 8, fgAttempted: 15, threeMade: 4, threeAttempted: 8, ftMade: 1, ftAttempted: 1, turnovers: 1, fouls: 2, team: 'Team E' },
            { name: 'Akif', points: 35, rebounds: 10, assists: 8, steals: 3, blocks: 2, fgMade: 14, fgAttempted: 25, threeMade: 5, threeAttempted: 10, ftMade: 2, ftAttempted: 3, turnovers: 3, fouls: 3, team: 'Team C' },
            { name: 'Ikroop', points: 18, rebounds: 5, assists: 3, steals: 1, blocks: 1, fgMade: 7, fgAttempted: 14, threeMade: 2, threeAttempted: 5, ftMade: 2, ftAttempted: 2, turnovers: 2, fouls: 2, team: 'Team C' },
            { name: 'Dylan', points: 15, rebounds: 4, assists: 2, steals: 1, blocks: 0, fgMade: 6, fgAttempted: 12, threeMade: 1, threeAttempted: 4, ftMade: 2, ftAttempted: 3, turnovers: 2, fouls: 1, team: 'Team C' },
            { name: 'Ankit', points: 12, rebounds: 3, assists: 1, steals: 0, blocks: 0, fgMade: 5, fgAttempted: 10, threeMade: 1, threeAttempted: 3, ftMade: 1, ftAttempted: 2, turnovers: 1, fouls: 1, team: 'Team C' },
            { name: 'TV', points: 18, rebounds: 2, assists: 1, steals: 0, blocks: 0, fgMade: 7, fgAttempted: 13, threeMade: 3, threeAttempted: 7, ftMade: 1, ftAttempted: 1, turnovers: 1, fouls: 2, team: 'Team C' },
          ],
          teams: [
            { name: 'Team E', points: 125, rebounds: 26, assists: 15, isHome: true },
            { name: 'Team C', points: 98, rebounds: 24, assists: 15, isHome: false },
          ],
        },
        {
          id: '3',
          date: new Date(Date.now() - 259200000).toISOString(),
          homeTeam: 'Team D',
          awayTeam: 'Team E',
          homeScore: 112,
          awayScore: 118,
          players: [
            { name: 'Anis', points: 38, rebounds: 9, assists: 12, steals: 5, blocks: 1, fgMade: 14, fgAttempted: 26, threeMade: 4, threeAttempted: 9, ftMade: 6, ftAttempted: 7, turnovers: 5, fouls: 3, team: 'Team D' },
            { name: 'Nillan', points: 24, rebounds: 8, assists: 6, steals: 2, blocks: 1, fgMade: 10, fgAttempted: 18, threeMade: 2, threeAttempted: 5, ftMade: 2, ftAttempted: 3, turnovers: 3, fouls: 2, team: 'Team D' },
            { name: 'Kashif', points: 20, rebounds: 6, assists: 4, steals: 1, blocks: 0, fgMade: 8, fgAttempted: 15, threeMade: 2, threeAttempted: 4, ftMade: 2, ftAttempted: 2, turnovers: 2, fouls: 2, team: 'Team D' },
            { name: 'Player 4', points: 16, rebounds: 4, assists: 2, steals: 1, blocks: 0, fgMade: 6, fgAttempted: 12, threeMade: 1, threeAttempted: 3, ftMade: 3, ftAttempted: 4, turnovers: 1, fouls: 1, team: 'Team D' },
            { name: 'Player 5', points: 14, rebounds: 3, assists: 1, steals: 0, blocks: 0, fgMade: 5, fgAttempted: 10, threeMade: 2, threeAttempted: 4, ftMade: 2, ftAttempted: 2, turnovers: 1, fouls: 1, team: 'Team D' },
            { name: 'Abdul', points: 40, rebounds: 9, assists: 6, steals: 2, blocks: 1, fgMade: 15, fgAttempted: 27, threeMade: 7, threeAttempted: 13, ftMade: 3, ftAttempted: 4, turnovers: 2, fouls: 2, team: 'Team E' },
            { name: 'Player 2', points: 26, rebounds: 7, assists: 5, steals: 2, blocks: 1, fgMade: 10, fgAttempted: 18, threeMade: 3, threeAttempted: 6, ftMade: 3, ftAttempted: 4, turnovers: 2, fouls: 2, team: 'Team E' },
            { name: 'Player 3', points: 22, rebounds: 6, assists: 4, steals: 1, blocks: 0, fgMade: 9, fgAttempted: 16, threeMade: 2, threeAttempted: 5, ftMade: 2, ftAttempted: 3, turnovers: 2, fouls: 3, team: 'Team E' },
            { name: 'Player 4', points: 18, rebounds: 5, assists: 3, steals: 1, blocks: 0, fgMade: 7, fgAttempted: 13, threeMade: 1, threeAttempted: 4, ftMade: 3, ftAttempted: 4, turnovers: 1, fouls: 1, team: 'Team E' },
            { name: 'Player 5', points: 12, rebounds: 4, assists: 2, steals: 0, blocks: 0, fgMade: 5, fgAttempted: 9, threeMade: 1, threeAttempted: 3, ftMade: 1, ftAttempted: 2, turnovers: 1, fouls: 1, team: 'Team E' },
          ],
          teams: [
            { name: 'Team D', points: 112, rebounds: 30, assists: 25, isHome: true },
            { name: 'Team E', points: 118, rebounds: 31, assists: 20, isHome: false },
          ],
        },
        {
          id: '4',
          date: new Date(Date.now() - 345600000).toISOString(),
          homeTeam: 'Team C',
          awayTeam: 'Team E',
          homeScore: 105,
          awayScore: 115,
          players: [
            { name: 'Akif', points: 30, rebounds: 8, assists: 6, steals: 3, blocks: 2, fgMade: 12, fgAttempted: 22, threeMade: 4, threeAttempted: 9, ftMade: 2, ftAttempted: 3, turnovers: 2, fouls: 2, team: 'Team C' },
            { name: 'Ikroop', points: 20, rebounds: 6, assists: 4, steals: 1, blocks: 1, fgMade: 8, fgAttempted: 15, threeMade: 2, threeAttempted: 5, ftMade: 2, ftAttempted: 2, turnovers: 2, fouls: 2, team: 'Team C' },
            { name: 'Dylan', points: 18, rebounds: 5, assists: 3, steals: 2, blocks: 0, fgMade: 7, fgAttempted: 14, threeMade: 2, threeAttempted: 5, ftMade: 2, ftAttempted: 3, turnovers: 2, fouls: 1, team: 'Team C' },
            { name: 'Ankit', points: 15, rebounds: 4, assists: 2, steals: 1, blocks: 0, fgMade: 6, fgAttempted: 11, threeMade: 1, threeAttempted: 3, ftMade: 2, ftAttempted: 3, turnovers: 1, fouls: 1, team: 'Team C' },
            { name: 'TV', points: 22, rebounds: 3, assists: 1, steals: 0, blocks: 0, fgMade: 8, fgAttempted: 14, threeMade: 5, threeAttempted: 9, ftMade: 1, ftAttempted: 1, turnovers: 1, fouls: 2, team: 'Team C' },
            { name: 'Abdul', points: 36, rebounds: 8, assists: 5, steals: 2, blocks: 1, fgMade: 14, fgAttempted: 25, threeMade: 6, threeAttempted: 11, ftMade: 2, ftAttempted: 3, turnovers: 2, fouls: 2, team: 'Team E' },
            { name: 'Player 2', points: 24, rebounds: 7, assists: 4, steals: 2, blocks: 1, fgMade: 9, fgAttempted: 17, threeMade: 3, threeAttempted: 6, ftMade: 3, ftAttempted: 4, turnovers: 2, fouls: 2, team: 'Team E' },
            { name: 'Player 3', points: 22, rebounds: 6, assists: 3, steals: 1, blocks: 0, fgMade: 9, fgAttempted: 16, threeMade: 2, threeAttempted: 5, ftMade: 2, ftAttempted: 3, turnovers: 2, fouls: 3, team: 'Team E' },
            { name: 'Player 4', points: 18, rebounds: 5, assists: 2, steals: 1, blocks: 0, fgMade: 7, fgAttempted: 13, threeMade: 1, threeAttempted: 4, ftMade: 3, ftAttempted: 4, turnovers: 1, fouls: 1, team: 'Team E' },
            { name: 'Player 5', points: 15, rebounds: 4, assists: 1, steals: 0, blocks: 0, fgMade: 6, fgAttempted: 11, threeMade: 2, threeAttempted: 4, ftMade: 1, ftAttempted: 2, turnovers: 1, fouls: 1, team: 'Team E' },
          ],
          teams: [
            { name: 'Team C', points: 105, rebounds: 26, assists: 16, isHome: true },
            { name: 'Team E', points: 115, rebounds: 30, assists: 15, isHome: false },
          ],
        },
        {
          id: '5',
          date: new Date(Date.now() - 432000000).toISOString(),
          homeTeam: 'Team D',
          awayTeam: 'Team C',
          homeScore: 98,
          awayScore: 110,
          players: [
            { name: 'Anis', points: 28, rebounds: 7, assists: 10, steals: 4, blocks: 1, fgMade: 11, fgAttempted: 21, threeMade: 3, threeAttempted: 8, ftMade: 3, ftAttempted: 4, turnovers: 4, fouls: 3, team: 'Team D' },
            { name: 'Nillan', points: 20, rebounds: 6, assists: 5, steals: 2, blocks: 1, fgMade: 8, fgAttempted: 15, threeMade: 2, threeAttempted: 4, ftMade: 2, ftAttempted: 3, turnovers: 2, fouls: 2, team: 'Team D' },
            { name: 'Kashif', points: 18, rebounds: 5, assists: 4, steals: 1, blocks: 0, fgMade: 7, fgAttempted: 13, threeMade: 2, threeAttempted: 4, ftMade: 2, ftAttempted: 2, turnovers: 2, fouls: 2, team: 'Team D' },
            { name: 'Player 4', points: 16, rebounds: 4, assists: 2, steals: 1, blocks: 0, fgMade: 6, fgAttempted: 11, threeMade: 1, threeAttempted: 3, ftMade: 3, ftAttempted: 4, turnovers: 1, fouls: 1, team: 'Team D' },
            { name: 'Player 5', points: 16, rebounds: 3, assists: 1, steals: 0, blocks: 0, fgMade: 6, fgAttempted: 10, threeMade: 2, threeAttempted: 4, ftMade: 2, ftAttempted: 2, turnovers: 1, fouls: 1, team: 'Team D' },
            { name: 'Akif', points: 45, rebounds: 12, assists: 8, steals: 4, blocks: 3, fgMade: 18, fgAttempted: 32, threeMade: 6, threeAttempted: 12, ftMade: 3, ftAttempted: 4, turnovers: 3, fouls: 2, team: 'Team C' },
            { name: 'Ikroop', points: 22, rebounds: 6, assists: 4, steals: 1, blocks: 1, fgMade: 9, fgAttempted: 16, threeMade: 2, threeAttempted: 5, ftMade: 2, ftAttempted: 2, turnovers: 2, fouls: 2, team: 'Team C' },
            { name: 'Dylan', points: 18, rebounds: 5, assists: 3, steals: 2, blocks: 0, fgMade: 7, fgAttempted: 14, threeMade: 2, threeAttempted: 5, ftMade: 2, ftAttempted: 3, turnovers: 2, fouls: 1, team: 'Team C' },
            { name: 'Ankit', points: 12, rebounds: 4, assists: 2, steals: 1, blocks: 0, fgMade: 5, fgAttempted: 10, threeMade: 1, threeAttempted: 3, ftMade: 1, ftAttempted: 2, turnovers: 1, fouls: 1, team: 'Team C' },
            { name: 'TV', points: 13, rebounds: 2, assists: 1, steals: 0, blocks: 0, fgMade: 5, fgAttempted: 10, threeMade: 2, threeAttempted: 5, ftMade: 1, ftAttempted: 1, turnovers: 1, fouls: 2, team: 'Team C' },
          ],
          teams: [
            { name: 'Team D', points: 98, rebounds: 25, assists: 22, isHome: true },
            { name: 'Team C', points: 110, rebounds: 29, assists: 17, isHome: false },
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
          <div className="bg-white rounded-lg max-w-7xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Game Details</h2>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => navigate(`/games/${selectedGame.id}/edit`)}
                    className="btn-primary flex items-center space-x-2"
                  >
                    <PencilIcon className="w-4 h-4" />
                    <span>Edit</span>
                  </button>
                  <button
                    onClick={() => setSelectedGame(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
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
                  {(() => {
                    // Group players by team
                    const homeTeamPlayers = selectedGame.players?.filter(p => p.team === selectedGame.homeTeam) || [];
                    const awayTeamPlayers = selectedGame.players?.filter(p => p.team === selectedGame.awayTeam) || [];
                    
                    return (
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Player
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              PTS
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              REB
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              AST
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              STL
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              BLK
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              FG
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              3PT
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              FT
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              TO
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              PF
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {/* Home Team Section */}
                          <tr className="bg-blue-50">
                            <td colSpan={11} className="px-4 py-3">
                              <div className="flex items-center">
                                <span className="text-sm font-bold text-blue-900">{selectedGame.homeTeam}</span>
                                <span className="ml-2 text-xs text-blue-700">({selectedGame.homeScore} pts)</span>
                              </div>
                            </td>
                          </tr>
                          {homeTeamPlayers.map((player, index) => (
                            <tr key={`home-${index}`} className="hover:bg-gray-50">
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm font-medium text-gray-900">{player.name}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.points || 0}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.rebounds || 0}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.assists || 0}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.steals || 0}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.blocks || 0}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">
                                  {player.fgMade || 0}/{player.fgAttempted || 0}
                                </div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">
                                  {player.threeMade || 0}/{player.threeAttempted || 0}
                                </div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">
                                  {player.ftMade || 0}/{player.ftAttempted || 0}
                                </div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.turnovers || 0}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.fouls || 0}</div>
                              </td>
                            </tr>
                          ))}
                          
                          {/* Away Team Section */}
                          <tr className="bg-red-50 border-t-4 border-gray-300">
                            <td colSpan={11} className="px-4 py-3">
                              <div className="flex items-center">
                                <span className="text-sm font-bold text-red-900">{selectedGame.awayTeam}</span>
                                <span className="ml-2 text-xs text-red-700">({selectedGame.awayScore} pts)</span>
                              </div>
                            </td>
                          </tr>
                          {awayTeamPlayers.map((player, index) => (
                            <tr key={`away-${index}`} className="hover:bg-gray-50">
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm font-medium text-gray-900">{player.name}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.points || 0}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.rebounds || 0}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.assists || 0}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.steals || 0}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.blocks || 0}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">
                                  {player.fgMade || 0}/{player.fgAttempted || 0}
                                </div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">
                                  {player.threeMade || 0}/{player.threeAttempted || 0}
                                </div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">
                                  {player.ftMade || 0}/{player.ftAttempted || 0}
                                </div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.turnovers || 0}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{player.fouls || 0}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
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
