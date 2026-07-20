import { Router, Request, Response } from 'express';
import { authenticateToken } from '@/middleware/auth';
import { resolveSquad, requireSquadId } from '@/middleware/squad';
import { ApiResponse } from '@/types';
import logger from '@/utils/logger';
import {
  listMappingsForSquad,
  createMapping,
  updateMapping,
  deleteMapping,
  getMappingById,
  applyRetroactiveMapping,
} from '@/services/mappingService';

const router = Router();

function validateFields(
  gamertag: unknown,
  displayName: unknown,
): string | null {
  if (!gamertag || typeof gamertag !== 'string' || gamertag.trim().length === 0 || gamertag.trim().length > 50) {
    return 'gamertag must be a non-empty string (max 50 chars)';
  }
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0 || displayName.trim().length > 50) {
    return 'displayName must be a non-empty string (max 50 chars)';
  }
  return null;
}

router.get('/', authenticateToken, resolveSquad, async (req: Request, res: Response) => {
  try {
    const mappings = await listMappingsForSquad(requireSquadId(req));
    return res.json({ success: true, data: mappings } as ApiResponse);
  } catch (err) {
    logger.error({ err }, 'GET /api/mappings failed');
    return res.status(500).json({ success: false, error: 'Failed to fetch mappings' } as ApiResponse);
  }
});

router.post('/', authenticateToken, resolveSquad, async (req: Request, res: Response) => {
  const { gamertag, displayName } = req.body as { gamertag?: string; displayName?: string };
  const validationError = validateFields(gamertag, displayName);
  if (validationError) {
    return res.status(400).json({ success: false, error: validationError } as ApiResponse);
  }
  try {
    const g = gamertag!.trim();
    const d = displayName!.trim();
    const mapping = await createMapping(requireSquadId(req), g, d);
    let retroactiveCount = 0;
    try {
      retroactiveCount = await applyRetroactiveMapping(requireSquadId(req), g, d);
    } catch (retroErr) {
      logger.error({ err: retroErr }, 'Retroactive rename failed after mapping create');
    }
    return res.status(201).json({ success: true, data: { mapping, retroactiveCount } } as ApiResponse);
  } catch (err: unknown) {
    if ((err as any)?.code === '23505') {
      return res.status(409).json({ success: false, error: 'A mapping for this gamertag already exists' } as ApiResponse);
    }
    logger.error({ err }, 'POST /api/mappings failed');
    return res.status(500).json({ success: false, error: 'Failed to create mapping' } as ApiResponse);
  }
});

router.put('/:id', authenticateToken, resolveSquad, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { gamertag, displayName } = req.body as { gamertag?: string; displayName?: string };
  const validationError = validateFields(gamertag, displayName);
  if (validationError) {
    return res.status(400).json({ success: false, error: validationError } as ApiResponse);
  }
  try {
    const g = gamertag!.trim();
    const d = displayName!.trim();
    const oldMapping = await getMappingById(id, requireSquadId(req));
    const mapping = await updateMapping(id, requireSquadId(req), g, d);
    let retroactiveCount = 0;
    try {
      retroactiveCount = await applyRetroactiveMapping(
        requireSquadId(req), g, d, oldMapping?.displayName,
      );
    } catch (retroErr) {
      logger.error({ err: retroErr }, 'Retroactive rename failed after mapping update');
    }
    return res.json({ success: true, data: { mapping, retroactiveCount } } as ApiResponse);
  } catch (err: unknown) {
    if ((err as any)?.status === 404) {
      return res.status(404).json({ success: false, error: 'Mapping not found' } as ApiResponse);
    }
    if ((err as any)?.code === '23505') {
      return res.status(409).json({ success: false, error: 'A mapping for this gamertag already exists' } as ApiResponse);
    }
    logger.error({ err }, 'PUT /api/mappings/:id failed');
    return res.status(500).json({ success: false, error: 'Failed to update mapping' } as ApiResponse);
  }
});

router.delete('/:id', authenticateToken, resolveSquad, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    await deleteMapping(id, requireSquadId(req));
    return res.json({ success: true, data: null } as ApiResponse);
  } catch (err: unknown) {
    if ((err as any)?.status === 404) {
      return res.status(404).json({ success: false, error: 'Mapping not found' } as ApiResponse);
    }
    logger.error({ err }, 'DELETE /api/mappings/:id failed');
    return res.status(500).json({ success: false, error: 'Failed to delete mapping' } as ApiResponse);
  }
});

export default router;
