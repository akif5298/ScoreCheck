import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { 
  ArrowUpTrayIcon, 
  ChartBarIcon, 
  CalendarIcon,
  ArrowTrendingUpIcon,
  UsersIcon,
  TrophyIcon 
} from '@heroicons/react/24/outline';

interface DashboardStats {
  totalGames: number;
  totalPlayers: number;
  totalTeams: number;
  avgPointsTeamAAndB: number;
  recentGames: any[];
  topPerformers: {
    points: any[];
    rebounds: any[];
    assists: any[];
  };
  teamStats: {
    name: string;
    avgPoints: number;
    avgRebounds: number;
    avgAssists: number;
  }[];
  playerStats: any[];
  gameHighs: {
    points: any[];
    rebounds: any[];
    assists: any[];
    steals: any[];
    blocks: any[];
    threeMade: any[];
  };
}

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const response = await axios.get('/api/analytics/dashboard');
      if (response.data.success) {
        setStats(response.data.data);
      } else {
        // If API returns unsuccessful response, set empty stats
        setStats({
          totalGames: 0,
          totalPlayers: 0,
          totalTeams: 0,
          avgPointsTeamAAndB: 0,
          recentGames: [],
          topPerformers: {
            points: [],
            rebounds: [],
            assists: [],
          },
          teamStats: [],
          playerStats: [],
          gameHighs: {
            points: [],
            rebounds: [],
            assists: [],
            steals: [],
            blocks: [],
            threeMade: [],
          },
        });
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast.error('Failed to load dashboard data');
      
      // Set empty stats on error - no mock data
      setStats({
        totalGames: 0,
        totalPlayers: 0,
        totalTeams: 0,
        avgPointsTeamAAndB: 0,
        recentGames: [],
        topPerformers: {
          points: [],
          rebounds: [],
          assists: [],
        },
        teamStats: [],
        playerStats: [],
        gameHighs: {
          points: [],
          rebounds: [],
          assists: [],
          steals: [],
          blocks: [],
          threeMade: [],
        },
      });
    } finally {
      setLoading(false);
    }
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
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Welcome to your NBA 2K25 analytics dashboard</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="stat-card">
          <div className="flex items-center">
            <div className="p-2 bg-primary-100 rounded-lg">
              <CalendarIcon className="w-6 h-6 text-primary-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Games</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.totalGames || 0}</p>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <UsersIcon className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Distinct Players</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.totalPlayers || 0}</p>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <TrophyIcon className="w-6 h-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Teams Tracked</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.totalTeams || 0}</p>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <ArrowTrendingUpIcon className="w-6 h-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                Avg OPPG 
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {stats?.avgPointsTeamAAndB?.toFixed(1) || '0.0'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link
          to="/upload"
          className="card hover:shadow-md transition-shadow duration-200 group"
        >
          <div className="flex items-center">
            <div className="p-3 bg-primary-100 rounded-lg group-hover:bg-primary-200 transition-colors duration-200">
              <ArrowUpTrayIcon className="w-6 h-6 text-primary-600" />
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-semibold text-gray-900">Upload Screenshot</h3>
              <p className="text-sm text-gray-600">Add a new box score to analyze</p>
            </div>
          </div>
        </Link>

        <Link
          to="/analytics"
          className="card hover:shadow-md transition-shadow duration-200 group"
        >
          <div className="flex items-center">
            <div className="p-3 bg-green-100 rounded-lg group-hover:bg-green-200 transition-colors duration-200">
              <ChartBarIcon className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-semibold text-gray-900">View Analytics</h3>
              <p className="text-sm text-gray-600">Explore detailed statistics</p>
            </div>
          </div>
        </Link>

        <Link
          to="/games"
          className="card hover:shadow-md transition-shadow duration-200 group"
        >
          <div className="flex items-center">
            <div className="p-3 bg-yellow-100 rounded-lg group-hover:bg-yellow-200 transition-colors duration-200">
              <CalendarIcon className="w-6 h-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-semibold text-gray-900">Game History</h3>
              <p className="text-sm text-gray-600">Browse all your games</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Recent Games */}
      <div className="card">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Recent Games</h2>
        <div className="space-y-3">
          {stats?.recentGames?.slice(0, 5).map((game) => (
            <div key={game.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">
                  {game.homeTeam} vs {game.awayTeam}
                </p>
                <p className="text-sm text-gray-600">
                  {new Date(game.date).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-900">
                  {game.homeScore} - {game.awayScore}
                </p>
                <p className="text-sm text-gray-600">
                  {game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam} won
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>



      {/* Game Highs */}
      <div className="card">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Game Highs</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Points */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">Most Points in a Game</h3>
            <div className="space-y-3">
              {stats?.gameHighs?.points?.slice(0, 5).map((player, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{player.playerName}</p>
                    <p className="text-sm text-gray-600">{player.team}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900 text-2xl">{player.value}</p>
                    <p className="text-xs text-gray-500">points</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rebounds */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">Most Rebounds in a Game</h3>
            <div className="space-y-3">
              {stats?.gameHighs?.rebounds?.slice(0, 5).map((player, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{player.playerName}</p>
                    <p className="text-sm text-gray-600">{player.team}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900 text-2xl">{player.value}</p>
                    <p className="text-xs text-gray-500">rebounds</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Assists */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">Most Assists in a Game</h3>
            <div className="space-y-3">
              {stats?.gameHighs?.assists?.slice(0, 5).map((player, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{player.playerName}</p>
                    <p className="text-sm text-gray-600">{player.team}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900 text-2xl">{player.value}</p>
                    <p className="text-xs text-gray-500">assists</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Steals */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">Most Steals in a Game</h3>
            <div className="space-y-3">
              {stats?.gameHighs?.steals?.slice(0, 5).map((player, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{player.playerName}</p>
                    <p className="text-sm text-gray-600">{player.team}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900 text-2xl">{player.value}</p>
                    <p className="text-xs text-gray-500">steals</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Blocks */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">Most Blocks in a Game</h3>
            <div className="space-y-3">
              {stats?.gameHighs?.blocks?.slice(0, 5).map((player, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{player.playerName}</p>
                    <p className="text-sm text-gray-600">{player.team}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900 text-2xl">{player.value}</p>
                    <p className="text-xs text-gray-500">blocks</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 3PM */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">Most 3PM in a Game</h3>
            <div className="space-y-3">
              {stats?.gameHighs?.threeMade?.slice(0, 5).map((player, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{player.playerName}</p>
                    <p className="text-sm text-gray-600">{player.team}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900 text-2xl">{player.value}</p>
                    <p className="text-xs text-gray-500">3PM</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Player Averages */}
      <div className="card">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Player Averages (All Games)</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Player</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Team</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Games</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PPG</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">RPG</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">APG</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SPG</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">BPG</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {stats?.playerStats?.map((player, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{player.playerName}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-600">{player.team}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-600">{player.gamesPlayed || 0}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{player.avgPoints?.toFixed(1) || '0.0'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{player.avgRebounds?.toFixed(1) || '0.0'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{player.avgAssists?.toFixed(1) || '0.0'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{player.avgSteals?.toFixed(1) || '0.0'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{player.avgBlocks?.toFixed(1) || '0.0'}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
