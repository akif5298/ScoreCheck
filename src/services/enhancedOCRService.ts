import { Player, GameData } from '../types';
import logger from '@/utils/logger';
import { applyMapping } from './mappingService';
import { extractBoxScore } from './ollamaExtractor';

export class EnhancedOCRService {
  private extractImageNumber(filename?: string): string {
    if (!filename) {
      return Date.now().toString();
    }
    const patterns = [
      /IMG_(\d+)\./i,
      /(\d+)-boxscore\./i,
      /(\d+)\./i,
      /(\d+)/,
    ];
    for (const pattern of patterns) {
      const match = filename.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    return Date.now().toString();
  }

  async extractStructuredDataFromImage(
    imageBuffer: Buffer,
    filename?: string,
    mappings?: Map<string, string>,
  ): Promise<{
    players: Player[];
    gameData: GameData;
    teamATotals: any;
    teamBTotals: any;
    teamBQuarters: any;
    teamAQuarters: any;
  }> {
    const imageNumber = this.extractImageNumber(filename);

    const { players: extractedPlayers } = await extractBoxScore(imageBuffer);

    const players: Player[] = extractedPlayers.map((p, i) => {
      const slot = i + 1;
      const teamLetter = slot <= 5 ? 'A' : 'B';
      const playerId = `${imageNumber}_${slot}_${teamLetter}`;
      return {
        id: playerId,
        name: p.name,
        team: `Team ${teamLetter}`,
        teammateGrade: p.grade || null,
        gameIdFromFile: imageNumber,
        playerId,
        position: EnhancedOCRService.getPositionFromPlayerNumber(playerId),
        points: p.points,
        rebounds: p.rebounds,
        assists: p.assists,
        steals: p.steals,
        blocks: p.blocks,
        fouls: p.fouls,
        turnovers: p.turnovers,
        fgMade: p.fgMade,
        fgAttempted: p.fgAttempted,
        threeMade: p.threeMade,
        threeAttempted: p.threeAttempted,
        ftMade: p.ftMade,
        ftAttempted: p.ftAttempted,
        createdAt: new Date(),
        updatedAt: new Date(),
        gameId: '',
        userId: '',
      };
    });

    if (mappings && mappings.size > 0) {
      for (const player of players) {
        player.name = applyMapping(player.name, mappings);
      }
    }

    const { teamAName, teamBName } = this.generateCustomTeamNames(players);

    const teamAPlayers = players.filter(p => p.team === 'Team A');
    const teamBPlayers = players.filter(p => p.team === 'Team B');
    const teamATotals = { points: teamAPlayers.reduce((s, p) => s + p.points, 0) };
    const teamBTotals = { points: teamBPlayers.reduce((s, p) => s + p.points, 0) };

    logger.debug(`Extracted ${players.length} players via Ollama for ${filename ?? 'unknown'}`);

    const gameData: GameData = {
      date: new Date().toISOString().split('T')[0] ?? new Date().toISOString().slice(0, 10),
      homeTeam: teamAName,
      awayTeam: teamBName,
      homeScore: teamATotals.points,
      awayScore: teamBTotals.points,
      quarters: 4,
    };

    return {
      players,
      gameData,
      teamATotals,
      teamBTotals,
      teamAQuarters: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
      teamBQuarters: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
    };
  }

  private generateCustomTeamNames(players: Player[]): { teamAName: string; teamBName: string } {
    return { teamAName: 'Team A', teamBName: 'Team B' };
  }

  static generateCustomTeamNamesAfterAssignment(players: Player[]): { teamAName: string; teamBName: string } {
    const customNames = [
      'Akif', 'Abdul', 'Anis', 'Ankit', 'Nillan', 'Ikroop', 'TV', 'Kashif', 'Dylan',
    ];

    const teamAPlayers = players.filter(p => p.team === 'Team A');
    const teamBPlayers = players.filter(p => p.team === 'Team B');

    const generateTeamName = (teamPlayers: Player[]): string | null => {
      const assignedPlayers = teamPlayers.filter(p => EnhancedOCRService.isCustomName(p.name, customNames));
      if (assignedPlayers.length === 0) return null;

      const allPlayersWithPositions = teamPlayers.map(p => {
        const position = EnhancedOCRService.getPositionFromPlayerNumber(p.id);
        if (EnhancedOCRService.isCustomName(p.name, customNames)) {
          return `${p.name} (${position})`;
        } else if (
          p.name.toLowerCase().includes('ai') ||
          p.name.toLowerCase().includes('al player') ||
          (p.name.toLowerCase().includes('player') && p.name.toLowerCase().includes('al')) ||
          p.name.toLowerCase().includes('al')
        ) {
          return `AI (${position})`;
        } else {
          return `Random (${position})`;
        }
      }).sort((a, b) => {
        const aPlayer = teamPlayers.find(p => {
          const pos = EnhancedOCRService.getPositionFromPlayerNumber(p.id);
          return a.includes(`(${pos})`);
        });
        const bPlayer = teamPlayers.find(p => {
          const pos = EnhancedOCRService.getPositionFromPlayerNumber(p.id);
          return b.includes(`(${pos})`);
        });
        if (!aPlayer || !bPlayer) return 0;
        const aIdParts = aPlayer.id.split('_');
        const bIdParts = bPlayer.id.split('_');
        const aNum = aIdParts.length >= 3 ? parseInt(aIdParts[2]!) || 0 : 0;
        const bNum = bIdParts.length >= 3 ? parseInt(bIdParts[2]!) || 0 : 0;
        return aNum - bNum;
      });

      return allPlayersWithPositions.join(' + ');
    };

    const teamAName = generateTeamName(teamAPlayers);
    const teamBName = generateTeamName(teamBPlayers);
    return {
      teamAName: teamAName ?? 'Team A',
      teamBName: teamBName ?? 'Team B',
    };
  }

  static getPositionFromPlayerNumber(playerId: string): string {
    let playerNum = 0;
    if (playerId.startsWith('P')) {
      playerNum = parseInt(playerId.substring(1)) || 0;
    } else {
      const idParts = playerId.split('_');
      if (idParts.length >= 3) {
        playerNum = parseInt(idParts[1]!) || 0;
      }
    }
    const positionMap: { [key: number]: string } = {
      1: 'PG', 6: 'PG',
      2: 'SG', 7: 'SG',
      3: 'SF', 8: 'SF',
      4: 'PF', 9: 'PF',
      5: 'C',  10: 'C',
    };
    return positionMap[playerNum] ?? 'N/A';
  }

  static isCustomName(playerName: string, customNames: string[]): boolean {
    const cleanedPlayerName = playerName.replace(/['"]/g, '').trim();
    const normalizedPlayerName = cleanedPlayerName.toLowerCase();
    return customNames.some(customName => {
      const normalizedCustomName = customName.toLowerCase().trim();
      if (normalizedPlayerName === normalizedCustomName) return true;
      if (normalizedPlayerName.includes(normalizedCustomName)) return true;
      if (normalizedCustomName.includes(normalizedPlayerName)) return true;
      if (normalizedPlayerName.includes('+') && normalizedPlayerName.includes(normalizedCustomName)) return true;
      return false;
    });
  }
}
