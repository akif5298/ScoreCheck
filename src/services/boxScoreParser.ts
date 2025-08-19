import { BoxScoreData, PlayerData, TeamData, TeamQuarterTotals, ExtractedRow } from '@/types';

export class BoxScoreParser {
  private extractedRows: ExtractedRow[];
  private filename: string;
  private teamAQuarters: TeamQuarterTotals | undefined;
  private teamBQuarters: TeamQuarterTotals | undefined;

  constructor(extractedRows: ExtractedRow[], filename: string, teamAQuarters?: TeamQuarterTotals, teamBQuarters?: TeamQuarterTotals) {
    this.extractedRows = extractedRows;
    this.filename = filename;
    this.teamAQuarters = teamAQuarters;
    this.teamBQuarters = teamBQuarters;
  }

  parse(): BoxScoreData {
    // Extract team names and scores from the first few rows
    const teamInfo = this.extractTeamInfo();
    
    console.log('🔍 BoxScoreParser: Starting parse with team info:', teamInfo);
    console.log('🔍 BoxScoreParser: Extracted rows count:', this.extractedRows.length);
    console.log('🔍 BoxScoreParser: Sample rows:', this.extractedRows.slice(0, 3).map(row => ({
      name: row.playerName,
      team: row.team,
      points: row.points
    })));
    
    // Convert extracted rows to player data with team assignments
    const players = this.convertRowsToPlayerData(teamInfo);
    
    console.log('🔍 BoxScoreParser: Converted players count:', players.length);
    console.log('🔍 BoxScoreParser: Final team breakdown:');
    const homeTeamPlayers = players.filter(p => p.team === teamInfo.homeTeam);
    const awayTeamPlayers = players.filter(p => p.team === teamInfo.awayTeam);
    console.log(`   ${teamInfo.homeTeam}: ${homeTeamPlayers.length} players`);
    console.log(`   ${teamInfo.awayTeam}: ${awayTeamPlayers.length} players`);
    
    // Extract team statistics
    const teams = this.extractTeamStats(teamInfo, players);
    
    // Create the final box score data
    const result: BoxScoreData = {
      homeTeam: teamInfo.homeTeam,
      awayTeam: teamInfo.awayTeam,
      homeScore: teamInfo.homeScore,
      awayScore: teamInfo.awayScore,
      players,
      teams,
    };

    // Only add quarter totals if they exist
    if (this.teamAQuarters) {
      result.teamAQuarters = this.teamAQuarters;
    }
    if (this.teamBQuarters) {
      result.teamBQuarters = this.teamBQuarters;
    }

    return result;
  }

  private extractTeamInfo(): { homeTeam: string; awayTeam: string; homeScore: number; awayScore: number } {
    // Use the actual team assignments from the OCR service
    // The OCR service already correctly assigns players to Team A (P6-P10) and Team B (P1-P5)
    // We should preserve these assignments and just map them to home/away for display purposes
    
    console.log('🔍 Extracting team info from OCR data...');
    
    // Count how many players are assigned to each team
    const teamACount = this.extractedRows.filter(row => row.team === 'Team A').length;
    const teamBCount = this.extractedRows.filter(row => row.team === 'Team B').length;
    
    console.log(`🔍 Team assignments from OCR: Team A (${teamACount} players), Team B (${teamBCount} players)`);
    
    // For display purposes, we'll map:
    // Team A (P1-P5, usually the top section) → Home Team
    // Team B (P6-P10, usually the bottom section) → Away Team
    // This matches the typical box score layout where home team is shown first
    
    const homeTeam = 'Team A';
    const awayTeam = 'Team B';
    const homeScore = 0; // Will be calculated from player stats
    const awayScore = 0; // Will be calculated from player stats
    
    console.log(`🎯 Team mapping: ${homeTeam} (Home) vs ${awayTeam} (Away)`);
    
    return { homeTeam, awayTeam, homeScore, awayScore };
  }



  private convertRowsToPlayerData(teamInfo: { homeTeam: string; awayTeam: string }): PlayerData[] {
    // First, create the player data without team assignment
    const playerDataWithoutTeams = this.extractedRows.map((row, index) => {
      const gameIdFromFile = this.extractGameIdFromFilename();
      const position = this.convertIndexToPosition(index + 1);
      
      // ✅ Preserve the original ID from OCR service, or generate a fallback
      const playerId = row.id || `${gameIdFromFile}-${index + 1}`;
      
      return {
        id: row.id || undefined, // ✅ Preserve the original ID (can be undefined)
        name: row.playerName,
        team: row.team, // ✅ Preserve the original team assignment from OCR
        teammateGrade: row.teammateGrade,
        gameIdFromFile,
        playerId,
        position,
        points: row.points,
        rebounds: row.rebounds,
        assists: row.assists,
        steals: row.steals,
        blocks: row.blocks,
        turnovers: row.turnovers,
        fouls: row.fouls,
        fgMade: row.fgMade,
        fgAttempted: row.fgAttempted,
        fgPercentage: row.fgAttempted > 0 ? (row.fgMade / row.fgAttempted) * 100 : 0,
        threeMade: row.threeMade,
        threeAttempted: row.threeAttempted,
        threePercentage: row.threeAttempted > 0 ? (row.threeMade / row.threeAttempted) * 100 : 0,
        ftMade: row.ftMade,
        ftAttempted: row.ftAttempted,
        ftPercentage: row.ftAttempted > 0 ? (row.ftMade / row.ftAttempted) * 100 : 0,
      };
    });

    // Now distribute players to teams naturally
    return this.distributePlayersToTeams(playerDataWithoutTeams, teamInfo);
  }

  private distributePlayersToTeams(players: PlayerData[], teamInfo: { homeTeam: string; awayTeam: string }): PlayerData[] {
    if (players.length === 0) return players;
    
    // IMPORTANT: Preserve the original team assignments from the OCR service
    // The OCR service already correctly assigns players to Team A (P1-P5) and Team B (P6-P10)
    // We should NOT randomly redistribute them as this breaks the correct team grouping
    
    console.log('🔍 Preserving original team assignments from OCR service...');
    console.log('🔍 Players with original teams:', players.map(p => ({ name: p.name, team: p.team })));
    
    // Map the original Team A/Team B assignments to the display team names
    const updatedPlayers = players.map(player => {
      if (player.team === 'Team A') {
        return { ...player, team: teamInfo.homeTeam };
      } else if (player.team === 'Team B') {
        return { ...player, team: teamInfo.awayTeam };
      } else {
        // Fallback for any players without team assignment
        console.warn(`⚠️ Player ${player.name} has no team assignment, defaulting to ${teamInfo.homeTeam}`);
        return { ...player, team: teamInfo.homeTeam };
      }
    });
    
    // Count players per team for logging
    const homeTeamCount = updatedPlayers.filter(p => p.team === teamInfo.homeTeam).length;
    const awayTeamCount = updatedPlayers.filter(p => p.team === teamInfo.awayTeam).length;
    
    console.log(`🎯 Preserved team assignments: ${teamInfo.homeTeam} (${homeTeamCount}), ${teamInfo.awayTeam} (${awayTeamCount})`);
    console.log('🔍 Final team assignments:', updatedPlayers.map(p => ({ name: p.name, team: p.team })));
    
    return updatedPlayers;
  }



  private extractGameIdFromFilename(): string {
    // Extract numbers from filename (e.g., "IMG_1754.jpg" -> "1754")
    const match = this.filename.match(/(\d+)/);
    return match && match[1] ? match[1] : '0000';
  }

  private convertIndexToPosition(index: number): string {
    // Convert row index to basketball position
    // P1-P5 (Team A): 1=PG, 2=SG, 3=SF, 4=PF, 5=C
    // P6-P10 (Team B): 6=PG, 7=SG, 8=SF, 9=PF, 10=C
    const positionMap: { [key: number]: string } = {
      1: 'PG', 6: 'PG',
      2: 'SG', 7: 'SG', 
      3: 'SF', 8: 'SF',
      4: 'PF', 9: 'PF',
      5: 'C', 10: 'C'
    };
    
    return positionMap[index] || 'PG'; // Default to PG if not in map
  }

  private extractTeamStats(teamInfo: { homeTeam: string; awayTeam: string }, players: PlayerData[]): TeamData[] {
    const teams: TeamData[] = [];
    
    // Calculate team totals from player data
    const homeTeamStats = this.calculateTeamStats(teamInfo.homeTeam, true, players);
    const awayTeamStats = this.calculateTeamStats(teamInfo.awayTeam, false, players);
    
    if (homeTeamStats) teams.push(homeTeamStats);
    if (awayTeamStats) teams.push(awayTeamStats);
    
    return teams;
  }

  private calculateTeamStats(teamName: string, isHome: boolean, players: PlayerData[]): TeamData | null {
    // Calculate team totals by summing up player statistics
    const teamPlayers = players.filter(player => player.team === teamName);
    
    if (teamPlayers.length === 0) {
      return null;
    }
    
    const totals = teamPlayers.reduce((acc, player) => ({
      points: acc.points + player.points,
      rebounds: acc.rebounds + player.rebounds,
      assists: acc.assists + player.assists,
      steals: acc.steals + player.steals,
      blocks: acc.blocks + player.blocks,
      turnovers: acc.turnovers + player.turnovers,
      fouls: acc.fouls + player.fouls,
      fgMade: acc.fgMade + player.fgMade,
      fgAttempted: acc.fgAttempted + player.fgAttempted,
      threeMade: acc.threeMade + player.threeMade,
      threeAttempted: acc.threeAttempted + player.threeAttempted,
      ftMade: acc.ftMade + player.ftMade,
      ftAttempted: acc.ftAttempted + player.ftAttempted,
    }), {
      points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0,
      turnovers: 0, fouls: 0, fgMade: 0, fgAttempted: 0,
      threeMade: 0, threeAttempted: 0, ftMade: 0, ftAttempted: 0
    });

    return {
      name: teamName,
      isHome,
      points: totals.points,
      rebounds: totals.rebounds,
      assists: totals.assists,
      steals: totals.steals,
      blocks: totals.blocks,
      turnovers: totals.turnovers,
      fouls: totals.fouls,
      fgMade: totals.fgMade,
      fgAttempted: totals.fgAttempted,
      threeMade: totals.threeMade,
      threeAttempted: totals.threeAttempted,
      ftMade: totals.ftMade,
      ftAttempted: totals.ftAttempted,
    };
  }
}

export default BoxScoreParser;
