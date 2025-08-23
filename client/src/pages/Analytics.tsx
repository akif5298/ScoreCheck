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
import {
  TrophyIcon,
  FireIcon,
  ArrowTrendingUpIcon,
  UsersIcon,
  ChartBarIcon,
  StarIcon,
} from '@heroicons/react/24/outline';

interface AnalyticsData {
  playerStats: any[];
  teamStats: any[];
  recentGames: any[];
  gameHighs: {
    points: any[];
    rebounds: any[];
    assists: any[];
    steals: any[];
    blocks: any[];
    threeMade: any[];
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
           { 
             playerName: 'Akif', 
             avgPoints: 25.3, 
             avgRebounds: 8.1, 
             avgAssists: 6.2, 
             avgSteals: 2.1, 
             avgBlocks: 1.8, 
             avgFgPercentage: 52.3, 
             avgThreePercentage: 38.7, 
             avgFtPercentage: 85.2,
             avgTurnovers: 2.8,
             avgFouls: 2.1,
             gamesPlayed: 12,
             team: 'Team C, Team D'
           },
           { 
             playerName: 'Anis', 
             avgPoints: 22.7, 
             avgRebounds: 6.8, 
             avgAssists: 7.5, 
             avgSteals: 1.9, 
             avgBlocks: 0.9, 
             avgFgPercentage: 48.9, 
             avgThreePercentage: 41.2, 
             avgFtPercentage: 78.5,
             avgTurnovers: 3.2,
             avgFouls: 2.5,
             gamesPlayed: 7,
             team: 'Team D'
           },
           { 
             playerName: 'Abdul', 
             avgPoints: 28.1, 
             avgRebounds: 7.2, 
             avgAssists: 4.8, 
             avgSteals: 1.5, 
             avgBlocks: 0.6, 
             avgFgPercentage: 55.7, 
             avgThreePercentage: 42.1, 
             avgFtPercentage: 89.3,
             avgTurnovers: 2.1,
             avgFouls: 1.8,
             gamesPlayed: 9,
             team: 'Team E'
           },
         ],
        teamStats: [
          { 
            name: 'Team C', 
            gamesPlayed: 6, 
            avgPoints: 105.8, 
            avgRebounds: 41.2, 
            avgAssists: 22.3, 
            wins: 4, 
            losses: 2,
            avgSteals: 7.5,
            avgBlocks: 4.5,
            avgTurnovers: 13.1,
            avgFouls: 17.8
          },
          { 
            name: 'Team D', 
            gamesPlayed: 7, 
            avgPoints: 98.3, 
            avgRebounds: 38.7, 
            avgAssists: 20.8, 
            wins: 3, 
            losses: 4,
            avgSteals: 6.8,
            avgBlocks: 3.2,
            avgTurnovers: 14.5,
            avgFouls: 19.8
          },
          { 
            name: 'Team E', 
            gamesPlayed: 5, 
            avgPoints: 115.2, 
            avgRebounds: 46.1, 
            avgAssists: 26.9, 
            wins: 4, 
            losses: 1,
            avgSteals: 9.8,
            avgBlocks: 5.2,
            avgTurnovers: 10.2,
            avgFouls: 16.5
          },
        ],
                 recentGames: [
           { id: '1', homeTeam: 'Team C', awayTeam: 'Team D', homeScore: 108, awayScore: 95, date: new Date() },
           { id: '2', homeTeam: 'Team E', awayTeam: 'Team C', homeScore: 125, awayScore: 98, date: new Date() },
           { id: '3', homeTeam: 'Team D', awayTeam: 'Team E', homeScore: 112, awayScore: 118, date: new Date() },
           { id: '4', homeTeam: 'Team C', awayTeam: 'Team E', homeScore: 105, awayScore: 115, date: new Date() },
         ],
                 gameHighs: {
           points: [
             { playerName: 'Akif', value: 45, team: 'Team C', date: new Date() },
             { playerName: 'Anis', value: 38, team: 'Team D', date: new Date() },
             { playerName: 'Abdul', value: 42, team: 'Team E', date: new Date() },
           ],
           rebounds: [
             { playerName: 'Akif', value: 18, team: 'Team C', date: new Date() },
             { playerName: 'Anis', value: 15, team: 'Team D', date: new Date() },
             { playerName: 'Abdul', value: 12, team: 'Team E', date: new Date() },
           ],
           assists: [
             { playerName: 'Anis', value: 15, team: 'Team D', date: new Date() },
             { playerName: 'Akif', value: 12, team: 'Team C', date: new Date() },
             { playerName: 'Abdul', value: 8, team: 'Team E', date: new Date() },
           ],
           steals: [
             { playerName: 'Akif', value: 6, team: 'Team C', date: new Date() },
             { playerName: 'Anis', value: 5, team: 'Team D', date: new Date() },
             { playerName: 'Abdul', value: 4, team: 'Team E', date: new Date() },
           ],
           blocks: [
             { playerName: 'Akif', value: 4, team: 'Team C', date: new Date() },
             { playerName: 'Anis', value: 3, team: 'Team D', date: new Date() },
             { playerName: 'Abdul', value: 2, team: 'Team E', date: new Date() },
           ],
           threeMade: [
             { playerName: 'Akif', value: 8, team: 'Team C', date: new Date() },
             { playerName: 'Anis', value: 6, team: 'Team D', date: new Date() },
             { playerName: 'Abdul', value: 7, team: 'Team E', date: new Date() },
           ],
         },
      });
    } finally {
      setLoading(false);
    }
  };

  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // Calculate cool overview stats
  const totalGames = data?.recentGames?.length || 0;
  const totalTeams = data?.teamStats?.length || 0;
  
  // Find highest scoring player
  const highestScorer = data?.playerStats?.length ? data.playerStats.reduce((max, player) => 
    player.avgPoints > max.avgPoints ? player : max
  ) : null;
  
  // Find most efficient player (highest FG%)
  const mostEfficient = data?.playerStats?.length ? data.playerStats.reduce((max, player) => {
    const currentFg = parseFloat(player.avgFgPercentage) || 0;
    const maxFg = parseFloat(max.avgFgPercentage) || 0;
    return currentFg > maxFg ? player : max;
  }) : null;
  
  // Find best team by win percentage
  const bestTeam = data?.teamStats?.length ? data.teamStats.reduce((max, team) => {
    const winPct = team.wins / (team.wins + team.losses);
    const maxWinPct = max.wins / (max.wins + max.losses);
    return winPct > maxWinPct ? team : max;
  }) : null;
  
  // Find highest scoring game (not team average)
  const highestScoringGame = data?.recentGames?.length ? data.recentGames.reduce((max, game) => {
    const maxScore = Math.max(game.homeScore || 0, game.awayScore || 0);
    const currentMax = Math.max(max.homeScore || 0, max.awayScore || 0);
    return maxScore > currentMax ? game : max;
  }) : null;
  
  // Calculate average team PPG from all recent games (including Team A and Team B)
  const avgTeamPPG = data?.recentGames && data.recentGames.length > 0 ? 
    (data.recentGames.reduce((sum, game) => sum + (game.homeScore || 0) + (game.awayScore || 0), 0) / data.recentGames.length).toFixed(1) : '0.0';

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
          {/* Cool Overview Stats */}
          <div className="space-y-6">
            {/* First row: Best Team only */}
            <div className="w-full">
                         <div className="stat-card bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
               <div className="flex items-center">
                 <div className="p-3 bg-blue-500 rounded-lg">
                   <TrophyIcon className="w-6 h-6 text-white" />
                 </div>
                 <div className="ml-4">
                   <h3 className="text-sm font-medium text-blue-700">Best Team</h3>
                   <p className="text-2xl font-bold text-blue-900">{bestTeam?.name || 'No Data'}</p>
                   <p className="text-xs text-blue-600">{bestTeam ? `${bestTeam.wins}-${bestTeam.losses}` : 'No team stats available'}</p>
                  </div>
                 </div>
               </div>
             </div>

            {/* Second row: Top Scorer, Most Efficient, Highest Scoring Game */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="stat-card bg-gradient-to-br from-green-50 to-green-100 border-green-200">
              <div className="flex items-center">
                <div className="p-3 bg-green-500 rounded-lg">
                  <FireIcon className="w-6 h-6 text-white" />
                </div>
                <div className="ml-4">
                  <h3 className="text-sm font-medium text-green-700">Top Scorer</h3>
                  <p className="text-2xl font-bold text-green-900">{highestScorer?.playerName || 'N/A'}</p>
                  <p className="text-xs text-green-600">{highestScorer ? `${highestScorer.avgPoints.toFixed(1)} PPG` : ''}</p>
                </div>
              </div>
            </div>

                         <div className="stat-card bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
               <div className="flex items-center">
                 <div className="p-3 bg-purple-500 rounded-lg">
                   <StarIcon className="w-6 h-6 text-white" />
                 </div>
                 <div className="ml-4">
                   <h3 className="text-sm font-medium text-purple-700">Most Efficient</h3>
                   <p className="text-2xl font-bold text-purple-900">{mostEfficient?.playerName || 'No Data'}</p>
                   <p className="text-xs text-purple-600">
                     {mostEfficient && mostEfficient.avgFgPercentage ? 
                       `${mostEfficient.avgFgPercentage.toFixed(1)}% FG` : 
                       'No shooting data'
                     }
                   </p>
                 </div>
               </div>
             </div>

                                                   <div className="stat-card bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
                <div className="flex items-center">
                  <div className="p-3 bg-orange-500 rounded-lg">
                    <ArrowTrendingUpIcon className="w-6 h-6 text-white" />
                  </div>
                  <div className="ml-4">
                    <h3 className="text-sm font-medium text-orange-700">Highest Scoring Game</h3>
                    <p className="text-2xl font-bold text-orange-900">
                      {highestScoringGame ? 
                        Math.max(highestScoringGame.homeScore || 0, highestScoringGame.awayScore || 0) : 
                        'No Data'
                      }
                    </p>
                    <p className="text-xs text-orange-600">
                      {highestScoringGame ? 
                        `${highestScoringGame.homeTeam} vs ${highestScoringGame.awayTeam}` : 
                        'No games available'
                      }
                    </p>
                  </div>
                  </div>
                </div>
              </div>
          </div>

          {/* Key Metrics - Third row: Total Games, Teams, Avg Team PPG */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="stat-card">
              <div className="flex items-center">
                <div className="p-2 bg-primary-100 rounded-lg">
                  <ChartBarIcon className="w-6 h-6 text-primary-600" />
                </div>
                <div className="ml-4">
                  <h3 className="text-sm font-medium text-gray-600">Total Games</h3>
                  <p className="text-2xl font-bold text-gray-900">{totalGames}</p>
                </div>
              </div>
            </div>
            
            <div className="stat-card">
              <div className="flex items-center">
                <div className="p-2 bg-yellow-100 rounded-lg">
                  <TrophyIcon className="w-6 h-6 text-yellow-600" />
                </div>
                <div className="ml-4">
                  <h3 className="text-sm font-medium text-gray-600">Teams</h3>
                  <p className="text-2xl font-bold text-gray-900">{totalTeams}</p>
                </div>
              </div>
            </div>
            
                         <div className="stat-card">
               <div className="flex items-center">
                 <div className="p-2 bg-purple-100 rounded-lg">
                   <FireIcon className="w-6 h-6 text-purple-600" />
                 </div>
                 <div className="ml-4">
                   <h3 className="text-sm font-medium text-gray-600">Avg Team PPG</h3>
                   <p className="text-2xl font-bold text-gray-900">
                    {avgTeamPPG}
                   </p>
                   <p className="text-xs text-gray-500">
                    {data?.recentGames && data.recentGames.length > 0 ? 
                      `${data.recentGames.length} games` : 
                      'No games available'
                     }
                   </p>
                 </div>
               </div>
             </div>
          </div>

          {/* Game Highs Preview */}
          <div className="card">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">Recent Game Highs</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Object.entries(data?.gameHighs || {}).slice(0, 3).map(([category, players]) => (
                <div key={category} className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3 text-center capitalize">
                    Top {category === 'threeMade' ? '3PM' : category}
                  </h3>
                  <div className="space-y-2">
                    {players.slice(0, 3).map((player, index) => (
                      <div key={index} className="flex items-center justify-between text-sm">
                        <span className="font-medium text-gray-900">{player.playerName}</span>
                        <span className="font-semibold text-gray-900">{player.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Player Stats Tab */}
      {activeTab === 'players' && (
        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Player Statistics (All Games)</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Player</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Team</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Games</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PPG</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">RPG</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">APG</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SPG</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">BPG</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">FG%</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">3P%</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">FT%</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">TO</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PF</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data?.playerStats?.map((player, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{player.playerName}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-600">{player.team}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.gamesPlayed || 0}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{player.avgPoints?.toFixed(1) || '0.0'}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.avgRebounds?.toFixed(1) || '0.0'}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.avgAssists?.toFixed(1) || '0.0'}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.avgSteals?.toFixed(1) || '0.0'}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.avgBlocks?.toFixed(1) || '0.0'}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.avgFgPercentage?.toFixed(1) || '0.0'}%</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.avgThreePercentage?.toFixed(1) || '0.0'}%</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.avgFtPercentage?.toFixed(1) || '0.0'}%</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.avgTurnovers?.toFixed(1) || '0.0'}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{player.avgFouls?.toFixed(1) || '0.0'}</div>
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
         <div className="space-y-6">
           {data?.teamStats?.length ? (
             <>
               {/* Team Performance Summary */}
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                 {data.teamStats.map((team, index) => (
                   <div key={index} className="stat-card">
                     <div className="text-center">
                       <h3 className="text-lg font-semibold text-gray-900 mb-2">{team.name}</h3>
                       <div className="text-3xl font-bold text-primary-600 mb-2">
                         {team.wins}-{team.losses}
                       </div>
                       <p className="text-sm text-gray-600">Record</p>
                       <div className="mt-3 text-sm text-gray-500">
                         <p>Games: {team.gamesPlayed}</p>
                         <p>PPG: {team.avgPoints.toFixed(1)}</p>
                       </div>
                     </div>
                   </div>
                 ))}
               </div>

                         {/* Detailed Team Stats Table */}
               <div className="card">
                 <h2 className="text-xl font-semibold text-gray-900 mb-6">Team Statistics Comparison</h2>
                 <div className="overflow-x-auto">
                   <table className="min-w-full divide-y divide-gray-200">
                     <thead className="bg-gray-50">
                       <tr>
                         <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Team</th>
                         <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Games</th>
                         <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">W-L</th>
                         <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Win%</th>
                         <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PPG</th>
                         <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">RPG</th>
                         <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">APG</th>
                         <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SPG</th>
                         <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">BPG</th>
                         <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">TO</th>
                         <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PF</th>
                       </tr>
                     </thead>
                     <tbody className="bg-white divide-y divide-gray-200">
                       {data.teamStats.map((team, index) => {
                         const winPercentage = ((team.wins / (team.wins + team.losses)) * 100).toFixed(1);
                         return (
                           <tr key={index} className="hover:bg-gray-50">
                             <td className="px-4 py-4 whitespace-nowrap">
                               <div className="text-sm font-medium text-gray-900">{team.name}</div>
                             </td>
                             <td className="px-4 py-4 whitespace-nowrap">
                               <div className="text-sm text-gray-900">{team.gamesPlayed}</div>
                             </td>
                             <td className="px-4 py-4 whitespace-nowrap">
                               <div className="text-sm text-gray-900">{team.wins}-{team.losses}</div>
                             </td>
                             <td className="px-4 py-4 whitespace-nowrap">
                               <div className="text-sm font-medium text-gray-900">{winPercentage}%</div>
                             </td>
                             <td className="px-4 py-4 whitespace-nowrap">
                               <div className="text-sm text-gray-900">{team.avgPoints.toFixed(1)}</div>
                             </td>
                             <td className="px-4 py-4 whitespace-nowrap">
                               <div className="text-sm text-gray-900">{team.avgRebounds.toFixed(1)}</div>
                             </td>
                             <td className="px-4 py-4 whitespace-nowrap">
                               <div className="text-sm text-gray-900">{team.avgAssists.toFixed(1)}</div>
                             </td>
                             <td className="px-4 py-4 whitespace-nowrap">
                               <div className="text-sm text-gray-900">{team.avgSteals?.toFixed(1) || '0.0'}</div>
                             </td>
                             <td className="px-4 py-4 whitespace-nowrap">
                               <div className="text-sm text-gray-900">{team.avgBlocks?.toFixed(1) || '0.0'}</div>
                             </td>
                             <td className="px-4 py-4 whitespace-nowrap">
                               <div className="text-sm text-gray-900">{team.avgTurnovers?.toFixed(1) || '0.0'}</div>
                             </td>
                             <td className="px-4 py-4 whitespace-nowrap">
                               <div className="text-sm text-gray-900">{team.avgFouls?.toFixed(1) || '0.0'}</div>
                             </td>
                           </tr>
                         );
                       })}
                     </tbody>
                   </table>
                 </div>
               </div>
             </>
           ) : (
             <div className="card text-center py-12">
               <div className="text-gray-500">
                 <TrophyIcon className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                 <h3 className="text-lg font-medium text-gray-900 mb-2">No Team Data Available</h3>
                 <p className="text-gray-500">
                   Team statistics are only calculated for games that don't include "Team A" or "Team B".
                 </p>
               </div>
             </div>
           )}
         </div>
       )}

      {/* Charts Tab */}
      {activeTab === 'charts' && (
        <div className="space-y-6">
          {/* Player Performance Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Player Scoring Comparison</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.playerStats?.slice(0, 8)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="playerName" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="avgPoints" fill="#3B82F6" name="PPG" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Player Efficiency (FG%)</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.playerStats?.slice(0, 8)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="playerName" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="avgFgPercentage" fill="#10B981" name="FG%" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Team Performance Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Win/Loss Distribution</h3>
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
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Scoring Comparison</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.teamStats}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="avgPoints" fill="#F59E0B" name="PPG" />
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
