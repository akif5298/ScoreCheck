import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

interface AnalyticsData {
  playerStats: any[];
  teamStats: any[];
  recentGames: any[];
  topPerformers: {
    points: any[];
    rebounds: any[];
    assists: any[];
  };
}

const Analytics: React.FC = () => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    fetchAnalyticsData();
  }, []);

  const fetchAnalyticsData = async () => {
    try {
      const response = await axios.get('/api/analytics/dashboard');
      if (response.data.success) {
        setData(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching analytics data:', error);
      toast.error('Failed to load analytics data');
      
      // Set mock data for demo
      setData({
        playerStats: [
          { playerName: 'LeBron James', avgPoints: 28.5, avgRebounds: 8.2, avgAssists: 8.7, team: 'Lakers' },
          { playerName: 'Stephen Curry', avgPoints: 26.2, avgRebounds: 5.1, avgAssists: 6.8, team: 'Warriors' },
          { playerName: 'Anthony Davis', avgPoints: 22.1, avgRebounds: 12.3, avgAssists: 3.2, team: 'Lakers' },
          { playerName: 'Draymond Green', avgPoints: 8.5, avgRebounds: 10.8, avgAssists: 7.1, team: 'Warriors' },
        ],
        teamStats: [
          { name: 'Lakers', gamesPlayed: 8, avgPoints: 108.5, avgRebounds: 42.3, avgAssists: 24.1, wins: 6, losses: 2 },
          { name: 'Warriors', gamesPlayed: 8, avgPoints: 112.2, avgRebounds: 44.8, avgAssists: 28.5, wins: 5, losses: 3 },
          { name: 'Celtics', gamesPlayed: 6, avgPoints: 105.8, avgRebounds: 41.2, avgAssists: 22.3, wins: 4, losses: 2 },
        ],
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

  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

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
        <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
        <p className="text-gray-600">Detailed statistics and insights from your NBA 2K25 games</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'overview', name: 'Overview' },
            { id: 'players', name: 'Player Stats' },
            { id: 'teams', name: 'Team Stats' },
            { id: 'charts', name: 'Charts' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="stat-card">
              <h3 className="text-sm font-medium text-gray-600">Total Games</h3>
              <p className="text-2xl font-bold text-gray-900">{data?.recentGames?.length || 0}</p>
            </div>
            <div className="stat-card">
              <h3 className="text-sm font-medium text-gray-600">Total Players</h3>
              <p className="text-2xl font-bold text-gray-900">{data?.playerStats?.length || 0}</p>
            </div>
            <div className="stat-card">
              <h3 className="text-sm font-medium text-gray-600">Teams Tracked</h3>
              <p className="text-2xl font-bold text-gray-900">{data?.teamStats?.length || 0}</p>
            </div>
            <div className="stat-card">
              <h3 className="text-sm font-medium text-gray-600">Avg PPG</h3>
              <p className="text-2xl font-bold text-gray-900">24.8</p>
            </div>
          </div>

          {/* Top Performers */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Scorers</h3>
              <div className="space-y-3">
                {data?.topPerformers?.points?.slice(0, 5).map((player, index) => (
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
                {data?.topPerformers?.rebounds?.slice(0, 5).map((player, index) => (
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
                {data?.topPerformers?.assists?.slice(0, 5).map((player, index) => (
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
      )}

      {/* Player Stats Tab */}
      {activeTab === 'players' && (
        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Player Statistics</h2>
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
                    PPG
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    RPG
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    APG
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data?.playerStats?.map((player, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{player.playerName}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.team}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.avgPoints.toFixed(1)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.avgRebounds.toFixed(1)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.avgAssists.toFixed(1)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Team Stats Tab */}
      {activeTab === 'teams' && (
        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Team Statistics</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Team
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Games
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    W-L
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Avg PPG
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Avg RPG
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Avg APG
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data?.teamStats?.map((team, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{team.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{team.gamesPlayed}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{team.wins}-{team.losses}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{team.avgPoints.toFixed(1)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{team.avgRebounds.toFixed(1)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{team.avgAssists.toFixed(1)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Charts Tab */}
      {activeTab === 'charts' && (
        <div className="space-y-6">
          {/* Points Distribution */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Points Distribution</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.playerStats?.slice(0, 8)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="playerName" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="avgPoints" fill="#3B82F6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Team Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Win/Loss Ratio</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data?.teamStats}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, wins, losses }) => `${name} (${wins}-${losses})`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="wins"
                    >
                      {data?.teamStats?.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Scoring</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.teamStats}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="avgPoints" fill="#10B981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Analytics;
