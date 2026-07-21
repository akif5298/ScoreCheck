import { Router } from 'express';
import { prisma } from '@/services/database';
import supabaseService from '@/services/supabase';
import { authenticateToken } from '@/middleware/auth';
import { requireAdmin } from '@/middleware/admin';
import { ApiResponse } from '@/types';
import logger from '@/utils/logger';

const router = Router();

// Apply authentication and admin middleware to all routes
router.use(authenticateToken);
router.use(requireAdmin);

// Get all users
router.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            uploadedGames: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json({
      success: true,
      data: users,
    } as ApiResponse);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching users');
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users',
    } as ApiResponse);
  }
});

// Get all games (admin can see all games)
router.get('/games', async (req, res) => {
  try {
    const games = await prisma.game.findMany({
      include: {
        uploadedBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        players: true,
        teams: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json({
      success: true,
      data: games,
    } as ApiResponse);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching games');
    res.status(500).json({
      success: false,
      error: 'Failed to fetch games',
    } as ApiResponse);
  }
});

// Delete a game (admin can delete any game, in any squad)
router.delete('/games/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;

    const result = await supabaseService.deleteGameById(gameId!);

    if (result.outcome === 'not_found') {
      return res.status(404).json({
        success: false,
        error: 'Game not found',
      } as ApiResponse);
    }

    // Past the commit: the game is gone regardless of what follows. Both cleanups are
    // non-transactional, so a failure in either is logged and still reported as success —
    // the delete itself succeeded. Mirrors the member delete path in screenshots.ts.
    if (result.screenshotUrl) {
      try {
        await supabaseService.deleteImage(result.screenshotUrl);
      } catch (storageErr) {
        logger.error(
          { err: storageErr, gameId, screenshotUrl: result.screenshotUrl },
          'Game deleted but its screenshot could not be removed from storage',
        );
      }
    }

    try {
      await supabaseService.recomputeSquadAggregates(result.squadId);
    } catch (aggregateErr) {
      logger.error(
        { err: aggregateErr, gameId, squadId: result.squadId },
        'Game deleted but squad aggregate rebuild failed — totals are stale until the next write',
      );
    }

    return res.json({
      success: true,
      message: 'Game deleted successfully',
    } as ApiResponse);
  } catch (error) {
    logger.error({ err: error }, 'Error deleting game');
    return res.status(500).json({
      success: false,
      error: 'Failed to delete game',
    } as ApiResponse);
  }
});

// Delete a user (admin can delete any user)
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      } as ApiResponse);
    }

    // Prevent admin from deleting themselves
    if (user.id === req.user?.userId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own account',
      } as ApiResponse);
    }

    await prisma.user.delete({
      where: { id: userId },
    });

    return res.json({
      success: true,
      message: 'User deleted successfully',
    } as ApiResponse);
  } catch (error) {
    logger.error({ err: error }, 'Error deleting user');
    return res.status(500).json({
      success: false,
      error: 'Failed to delete user',
    } as ApiResponse);
  }
});

// Update user role
router.patch('/users/:userId/role', async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!role || !['USER', 'ADMIN'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role. Must be USER or ADMIN',
      } as ApiResponse);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      } as ApiResponse);
    }

    // Prevent admin from changing their own role
    if (user.id === req.user?.userId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot change your own role',
      } as ApiResponse);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    return res.json({
      success: true,
      data: updatedUser,
      message: 'User role updated successfully',
    } as ApiResponse);
  } catch (error) {
    logger.error({ err: error }, 'Error updating user role');
    return res.status(500).json({
      success: false,
      error: 'Failed to update user role',
    } as ApiResponse);
  }
});

// Get admin dashboard statistics
router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalUsers,
      totalGames,
      totalPlayers,
      recentGames,
      topUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.game.count(),
      prisma.player.count(),
      prisma.game.findMany({
        take: 10,
        include: {
          uploadedBy: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.user.findMany({
        take: 5,
        select: {
          id: true,
          email: true,
          name: true,
          _count: {
            select: {
              uploadedGames: true,
            },
          },
        },
        orderBy: {
          uploadedGames: {
            _count: 'desc',
          },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        totalGames,
        totalPlayers,
        recentGames,
        topUsers,
      },
    } as ApiResponse);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching admin dashboard');
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admin dashboard',
    } as ApiResponse);
  }
});

export default router;