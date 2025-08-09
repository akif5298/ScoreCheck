import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { 
  UploadIcon, 
  ChartBarIcon, 
  CalendarIcon,
  TrendingUpIcon,
  UsersIcon,
  TrophyIcon 
} from '@heroicons/react/outline';

interface DashboardStats {
  totalGames: number;
  totalPlayers: number;
  totalTeams: number;
  recentGames: any[];
  topPerformers: {
    points: any[];
    rebounds: any[];
    assists: any[];
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
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast.error('Failed to load dashboard data');
      
      // Set mock data for demo
      setStats({
        totalGames: 12,
        totalPlayers: 48,
        totalTeams: 8,
        recentGames: [
          { id: '1', homeTeam: 'Lakers', awayTeam: 'Celtics', homeScore: 108, awayScore: 95, date: new Date() },
          { id: '2', homeTeam: 'Warriors', awayTeam: 'Bulls', homeScore: 112, awayScore: 98, date: new Date() },
        ],
        topPerformers: {
          points: [
            { playerName: 'LeBron James', avgPoints: 28.5, team: 'Lakers' },
            { playerName: 'Stephen Curry', avgPoints: 26.2, team: 'Warriors' },
          ],
          rebounds: [
            { playerName: 'Anthony Davis', avgRebounds: 12.3, team: 'Lakers' },
            { playerName: 'Draymond Green', avgRebounds: 10.8, team: 'Warriors' },
          ],
          assists: [
            { playerName: 'Chris Paul', avgAssists: 9.1, team: 'Suns' },
            { playerName: 'LeBron James', avgAssists: 8.7, team: 'Lakers' },
          ],
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
              <p className="text-sm font-medium text-gray-600">Total Players</p>
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
              <TrendingUpIcon className="w-6 h-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Avg PPG</p>
              <p className="text-2xl font-bold text-gray-900">24.8</p>
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
              <UploadIcon className="w-6 h-6 text-primary-600" />
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

      {/* Top Performers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Scorers</h3>
          <div className="space-y-3">
            {stats?.topPerformers?.points?.slice(0, 3).map((player, index) => (
              <div key={index} className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{player.playerName}</p>
                  <p className="text-sm text-gray-600">{player.team}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-900">{player.avgPoints.toFixed(1)} PPG</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Rebounders</h3>
          <div className="space-y-3">
            {stats?.topPerformers?.rebounds?.slice(0, 3).map((player, index) => (
              <div key={index} className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{player.playerName}</p>
                  <p className="text-sm text-gray-600">{player.team}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-900">{player.avgRebounds.toFixed(1)} RPG</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Assists</h3>
          <div className="space-y-3">
            {stats?.topPerformers?.assists?.slice(0, 3).map((player, index) => (
              <div key={index} className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{player.playerName}</p>
                  <p className="text-sm text-gray-600">{player.team}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-900">{player.avgAssists.toFixed(1)} APG</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
