import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface AdminStats {
  totalUsers: number;
  totalGames: number;
  totalPlayers: number;
  recentGames: any[];
  topUsers: any[];
}

interface User {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
  _count: {
    games: number;
  };
}

const AdminDashboard: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'games'>('overview');

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    try {
      setLoading(true);
      // In a real implementation, these would be actual API calls
      // For now, using mock data
      const mockStats: AdminStats = {
        totalUsers: 156,
        totalGames: 892,
        totalPlayers: 2340,
        recentGames: [
          { id: '1', homeTeam: 'Lakers', awayTeam: 'Warriors', homeScore: 108, awayScore: 102, createdAt: '2024-01-15', user: { name: 'John Doe', email: 'john@example.com' } },
          { id: '2', homeTeam: 'Celtics', awayTeam: 'Heat', homeScore: 95, awayScore: 98, createdAt: '2024-01-14', user: { name: 'Jane Smith', email: 'jane@example.com' } },
        ],
        topUsers: [
          { id: '1', name: 'John Doe', email: 'john@example.com', _count: { games: 45 } },
          { id: '2', name: 'Jane Smith', email: 'jane@example.com', _count: { games: 38 } },
          { id: '3', name: 'Mike Johnson', email: 'mike@example.com', _count: { games: 32 } },
        ],
      };

      const mockUsers: User[] = [
        { id: '1', email: 'john@example.com', name: 'John Doe', role: 'USER', createdAt: '2024-01-01', _count: { games: 45 } },
        { id: '2', email: 'jane@example.com', name: 'Jane Smith', role: 'ADMIN', createdAt: '2024-01-02', _count: { games: 38 } },
        { id: '3', email: 'mike@example.com', name: 'Mike Johnson', role: 'USER', createdAt: '2024-01-03', _count: { games: 32 } },
      ];

      setStats(mockStats);
      setUsers(mockUsers);
    } catch (error) {
      console.error('Error fetching admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }

    try {
      // In a real implementation, this would be an API call
      console.log('Deleting user:', userId);
      setUsers(users.filter(user => user.id !== userId));
    } catch (error) {
      console.error('Error deleting user:', error);
    }
  };

  const handleUpdateUserRole = async (userId: string, newRole: 'USER' | 'ADMIN') => {
    try {
      // In a real implementation, this would be an API call
      console.log('Updating user role:', userId, newRole);
      setUsers(users.map(user => 
        user.id === userId ? { ...user, role: newRole } : user
      ));
    } catch (error) {
      console.error('Error updating user role:', error);
    }
  };

  const handleDeleteGame = async (gameId: string) => {
    if (!confirm('Are you sure you want to delete this game? This action cannot be undone.')) {
      return;
    }

    try {
      // In a real implementation, this would be an API call
      console.log('Deleting game:', gameId);
      if (stats) {
        setStats({
          ...stats,
          recentGames: stats.recentGames.filter(game => game.id !== gameId),
        });
      }
    } catch (error) {
      console.error('Error deleting game:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-600">Manage users, games, and system data</p>
          </div>
          <div className="flex items-center space-x-2">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
              Admin Access
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6">
            {[
              { id: 'overview', name: 'Overview', icon: '📊' },
              { id: 'users', name: 'Users', icon: '👥' },
              { id: 'games', name: 'Games', icon: '🏀' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.name}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && stats && (
            <div className="space-y-6">
              {/* Statistics Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-blue-50 rounded-lg p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-blue-600 rounded-md flex items-center justify-center">
                        <span className="text-white text-sm font-medium">👥</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-blue-600">Total Users</p>
                      <p className="text-2xl font-bold text-blue-900">{stats.totalUsers}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-green-50 rounded-lg p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-green-600 rounded-md flex items-center justify-center">
                        <span className="text-white text-sm font-medium">🏀</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-green-600">Total Games</p>
                      <p className="text-2xl font-bold text-green-900">{stats.totalGames}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-purple-50 rounded-lg p-6">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-purple-600 rounded-md flex items-center justify-center">
                        <span className="text-white text-sm font-medium">👤</span>
                      </div>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-purple-600">Total Players</p>
                      <p className="text-2xl font-bold text-purple-900">{stats.totalPlayers}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Games */}
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Games</h3>
                <div className="space-y-3">
                  {stats.recentGames.map((game) => (
                    <div key={game.id} className="flex items-center justify-between bg-white p-4 rounded-lg shadow-sm">
                      <div>
                        <p className="font-medium text-gray-900">
                          {game.homeTeam} vs {game.awayTeam}
                        </p>
                        <p className="text-sm text-gray-600">
                          {game.homeScore} - {game.awayScore} • {game.user.name}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm text-gray-500">{game.createdAt}</span>
                        <button
                          onClick={() => handleDeleteGame(game.id)}
                          className="text-red-600 hover:text-red-800 text-sm font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top Users */}
              <div className="bg-gray-50 rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Top Users</h3>
                <div className="space-y-3">
                  {stats.topUsers.map((user, index) => (
                    <div key={user.id} className="flex items-center justify-between bg-white p-4 rounded-lg shadow-sm">
                      <div className="flex items-center space-x-3">
                        <span className="text-lg font-bold text-gray-400">#{index + 1}</span>
                        <div>
                          <p className="font-medium text-gray-900">{user.name}</p>
                          <p className="text-sm text-gray-600">{user.email}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-gray-900">{user._count.games} games</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Users Tab */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-gray-900">User Management</h3>
                <span className="text-sm text-gray-500">{users.length} users</span>
              </div>
              
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        User
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Role
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Games
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Joined
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{user.name}</div>
                            <div className="text-sm text-gray-500">{user.email}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <select
                            value={user.role}
                            onChange={(e) => handleUpdateUserRole(user.id, e.target.value as 'USER' | 'ADMIN')}
                            className="text-sm border border-gray-300 rounded px-2 py-1"
                          >
                            <option value="USER">User</option>
                            <option value="ADMIN">Admin</option>
                          </select>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {user._count.games}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Games Tab */}
          {activeTab === 'games' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-gray-900">Game Management</h3>
                <span className="text-sm text-gray-500">{stats?.totalGames || 0} games</span>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-6">
                <p className="text-gray-600">
                  Game management features will be implemented here. Admins can view, edit, and delete any game in the system.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
