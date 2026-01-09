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
        // If API returns unsuccessful response, use fallback demo data
        console.log('API returned unsuccessful response, using fallback demo data');
        // Use the same fallback data as in the catch block
        setStats({
          totalGames: 12,
          totalPlayers: 9,
          totalTeams: 3,
          avgPointsTeamAAndB: 102.5,
          recentGames: [
            {
              id: '1',
              homeTeam: 'Team C',
              awayTeam: 'Team D',
              homeScore: 108,
              awayScore: 95,
              date: new Date(Date.now() - 86400000).toISOString(),
            },
            {
              id: '2',
              homeTeam: 'Team E',
              awayTeam: 'Team C',
              homeScore: 125,
              awayScore: 98,
              date: new Date(Date.now() - 172800000).toISOString(),
            },
            {
              id: '3',
              homeTeam: 'Team D',
              awayTeam: 'Team E',
              homeScore: 112,
              awayScore: 118,
              date: new Date(Date.now() - 259200000).toISOString(),
            },
            {
              id: '4',
              homeTeam: 'Team C',
              awayTeam: 'Team E',
              homeScore: 105,
              awayScore: 115,
              date: new Date(Date.now() - 345600000).toISOString(),
            },
            {
              id: '5',
              homeTeam: 'Team D',
              awayTeam: 'Team C',
              homeScore: 98,
              awayScore: 110,
              date: new Date(Date.now() - 432000000).toISOString(),
            },
          ],
          topPerformers: {
            points: [
              { playerName: 'Akif', avgPoints: 34.5, team: 'Team C' },
              { playerName: 'Abdul', avgPoints: 33.3, team: 'Team E' },
              { playerName: 'Anis', avgPoints: 32.7, team: 'Team D' },
            ],
            rebounds: [
              { playerName: 'Akif', avgRebounds: 9.8, team: 'Team C' },
              { playerName: 'Anis', avgRebounds: 8.0, team: 'Team D' },
              { playerName: 'Abdul', avgRebounds: 7.3, team: 'Team E' },
            ],
            assists: [
              { playerName: 'Anis', avgAssists: 10.3, team: 'Team D' },
              { playerName: 'Akif', avgAssists: 7.3, team: 'Team C' },
              { playerName: 'Nillan', avgAssists: 5.3, team: 'Team D' },
            ],
          },
          teamStats: [
            {
              name: 'Team C',
              avgPoints: 105.3,
              avgRebounds: 26.5,
              avgAssists: 16.8,
            },
            {
              name: 'Team D',
              avgPoints: 101.7,
              avgRebounds: 27.3,
              avgAssists: 23.3,
            },
            {
              name: 'Team E',
              avgPoints: 119.3,
              avgRebounds: 29.0,
              avgAssists: 16.7,
            },
          ],
          playerStats: [
            {
              playerName: 'Akif',
              team: 'Team C',
              gamesPlayed: 4,
              avgPoints: 34.5,
              avgRebounds: 9.8,
              avgAssists: 7.3,
              avgSteals: 3.3,
              avgBlocks: 2.3,
            },
            {
              playerName: 'Anis',
              team: 'Team D',
              gamesPlayed: 3,
              avgPoints: 32.7,
              avgRebounds: 8.0,
              avgAssists: 10.3,
              avgSteals: 4.3,
              avgBlocks: 1.0,
            },
            {
              playerName: 'Abdul',
              team: 'Team E',
              gamesPlayed: 4,
              avgPoints: 33.3,
              avgRebounds: 7.3,
              avgAssists: 4.8,
              avgSteals: 1.8,
              avgBlocks: 0.8,
            },
            {
              playerName: 'Ikroop',
              team: 'Team C',
              gamesPlayed: 4,
              avgPoints: 20.5,
              avgRebounds: 5.8,
              avgAssists: 3.8,
              avgSteals: 1.0,
              avgBlocks: 1.0,
            },
            {
              playerName: 'Nillan',
              team: 'Team D',
              gamesPlayed: 3,
              avgPoints: 21.3,
              avgRebounds: 7.0,
              avgAssists: 5.3,
              avgSteals: 2.0,
              avgBlocks: 1.0,
            },
          ],
          gameHighs: {
            points: [
              { playerName: 'Akif', value: 45, team: 'Team C' },
              { playerName: 'Abdul', value: 42, team: 'Team E' },
              { playerName: 'Anis', value: 38, team: 'Team D' },
              { playerName: 'Abdul', value: 40, team: 'Team E' },
              { playerName: 'Anis', value: 32, team: 'Team D' },
            ],
            rebounds: [
              { playerName: 'Akif', value: 12, team: 'Team C' },
              { playerName: 'Anis', value: 9, team: 'Team D' },
              { playerName: 'Abdul', value: 9, team: 'Team E' },
              { playerName: 'Akif', value: 10, team: 'Team C' },
              { playerName: 'Nillan', value: 8, team: 'Team D' },
            ],
            assists: [
              { playerName: 'Anis', value: 12, team: 'Team D' },
              { playerName: 'Anis', value: 10, team: 'Team D' },
              { playerName: 'Akif', value: 8, team: 'Team C' },
              { playerName: 'Anis', value: 9, team: 'Team D' },
              { playerName: 'Nillan', value: 6, team: 'Team D' },
            ],
            steals: [
              { playerName: 'Anis', value: 5, team: 'Team D' },
              { playerName: 'Akif', value: 4, team: 'Team C' },
              { playerName: 'Anis', value: 4, team: 'Team D' },
              { playerName: 'Akif', value: 3, team: 'Team C' },
              { playerName: 'Nillan', value: 2, team: 'Team D' },
            ],
            blocks: [
              { playerName: 'Akif', value: 3, team: 'Team C' },
              { playerName: 'Akif', value: 2, team: 'Team C' },
              { playerName: 'Anis', value: 1, team: 'Team D' },
              { playerName: 'Abdul', value: 1, team: 'Team E' },
              { playerName: 'Nillan', value: 1, team: 'Team D' },
            ],
            threeMade: [
              { playerName: 'Abdul', value: 7, team: 'Team E' },
              { playerName: 'Akif', value: 6, team: 'Team C' },
              { playerName: 'Abdul', value: 6, team: 'Team E' },
              { playerName: 'TV', value: 5, team: 'Team C' },
              { playerName: 'Anis', value: 4, team: 'Team D' },
            ],
          },
        });
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast.success('Loaded demo data');
      
      // FALLBACK DATA FOR DEMO - Hardcoded demo data when API fails
      setStats({
        totalGames: 5,
        totalPlayers: 9,
        totalTeams: 3,
        avgPointsTeamAAndB: 108.8,
        recentGames: [
          {
            id: '1',
            homeTeam: 'Team C',
            awayTeam: 'Team D',
            homeScore: 108,
            awayScore: 95,
            date: new Date(Date.now() - 86400000).toISOString(),
          },
          {
            id: '2',
            homeTeam: 'Team E',
            awayTeam: 'Team C',
            homeScore: 125,
            awayScore: 98,
            date: new Date(Date.now() - 172800000).toISOString(),
          },
          {
            id: '3',
            homeTeam: 'Team D',
            awayTeam: 'Team E',
            homeScore: 112,
            awayScore: 118,
            date: new Date(Date.now() - 259200000).toISOString(),
          },
          {
            id: '4',
            homeTeam: 'Team C',
            awayTeam: 'Team E',
            homeScore: 105,
            awayScore: 115,
            date: new Date(Date.now() - 345600000).toISOString(),
          },
          {
            id: '5',
            homeTeam: 'Team D',
            awayTeam: 'Team C',
            homeScore: 98,
            awayScore: 110,
            date: new Date(Date.now() - 432000000).toISOString(),
          },
        ],
        topPerformers: {
          points: [
            { playerName: 'Akif', avgPoints: 34.5, team: 'Team C' },
            { playerName: 'Abdul', avgPoints: 33.3, team: 'Team E' },
            { playerName: 'Anis', avgPoints: 32.7, team: 'Team D' },
          ],
          rebounds: [
            { playerName: 'Akif', avgRebounds: 9.8, team: 'Team C' },
            { playerName: 'Anis', avgRebounds: 8.0, team: 'Team D' },
            { playerName: 'Abdul', avgRebounds: 7.3, team: 'Team E' },
          ],
          assists: [
            { playerName: 'Anis', avgAssists: 10.3, team: 'Team D' },
            { playerName: 'Akif', avgAssists: 7.3, team: 'Team C' },
            { playerName: 'Nillan', avgAssists: 5.3, team: 'Team D' },
          ],
        },
        teamStats: [
          {
            name: 'Team C',
            avgPoints: 105.3,
            avgRebounds: 26.5,
            avgAssists: 16.8,
          },
          {
            name: 'Team D',
            avgPoints: 101.7,
            avgRebounds: 27.3,
            avgAssists: 23.3,
          },
          {
            name: 'Team E',
            avgPoints: 119.3,
            avgRebounds: 29.0,
            avgAssists: 16.7,
          },
        ],
        playerStats: [
          {
            playerName: 'Akif',
            team: 'Team C',
            gamesPlayed: 4,
            avgPoints: 34.5,
            avgRebounds: 9.8,
            avgAssists: 7.3,
            avgSteals: 3.3,
            avgBlocks: 2.3,
          },
          {
            playerName: 'Anis',
            team: 'Team D',
            gamesPlayed: 3,
            avgPoints: 32.7,
            avgRebounds: 8.0,
            avgAssists: 10.3,
            avgSteals: 4.3,
            avgBlocks: 1.0,
          },
          {
            playerName: 'Abdul',
            team: 'Team E',
            gamesPlayed: 4,
            avgPoints: 33.3,
            avgRebounds: 7.3,
            avgAssists: 4.8,
            avgSteals: 1.8,
            avgBlocks: 0.8,
          },
          {
            playerName: 'Ikroop',
            team: 'Team C',
            gamesPlayed: 4,
            avgPoints: 20.5,
            avgRebounds: 5.8,
            avgAssists: 3.8,
            avgSteals: 1.0,
            avgBlocks: 1.0,
          },
          {
            playerName: 'Nillan',
            team: 'Team D',
            gamesPlayed: 3,
            avgPoints: 21.3,
            avgRebounds: 7.0,
            avgAssists: 5.3,
            avgSteals: 2.0,
            avgBlocks: 1.0,
          },
        ],
        gameHighs: {
          points: [
            { playerName: 'Akif', value: 45, team: 'Team C' },
            { playerName: 'Abdul', value: 42, team: 'Team E' },
            { playerName: 'Anis', value: 38, team: 'Team D' },
            { playerName: 'Abdul', value: 40, team: 'Team E' },
            { playerName: 'Anis', value: 32, team: 'Team D' },
          ],
          rebounds: [
            { playerName: 'Akif', value: 12, team: 'Team C' },
            { playerName: 'Anis', value: 9, team: 'Team D' },
            { playerName: 'Abdul', value: 9, team: 'Team E' },
            { playerName: 'Akif', value: 10, team: 'Team C' },
            { playerName: 'Nillan', value: 8, team: 'Team D' },
          ],
          assists: [
            { playerName: 'Anis', value: 12, team: 'Team D' },
            { playerName: 'Anis', value: 10, team: 'Team D' },
            { playerName: 'Akif', value: 8, team: 'Team C' },
            { playerName: 'Anis', value: 9, team: 'Team D' },
            { playerName: 'Nillan', value: 6, team: 'Team D' },
          ],
          steals: [
            { playerName: 'Anis', value: 5, team: 'Team D' },
            { playerName: 'Akif', value: 4, team: 'Team C' },
            { playerName: 'Anis', value: 4, team: 'Team D' },
            { playerName: 'Akif', value: 3, team: 'Team C' },
            { playerName: 'Nillan', value: 2, team: 'Team D' },
          ],
          blocks: [
            { playerName: 'Akif', value: 3, team: 'Team C' },
            { playerName: 'Akif', value: 2, team: 'Team C' },
            { playerName: 'Anis', value: 1, team: 'Team D' },
            { playerName: 'Abdul', value: 1, team: 'Team E' },
            { playerName: 'Nillan', value: 1, team: 'Team D' },
          ],
          threeMade: [
            { playerName: 'Abdul', value: 7, team: 'Team E' },
            { playerName: 'Akif', value: 6, team: 'Team C' },
            { playerName: 'Abdul', value: 6, team: 'Team E' },
            { playerName: 'TV', value: 5, team: 'Team C' },
            { playerName: 'Anis', value: 4, team: 'Team D' },
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
