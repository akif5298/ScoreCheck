import { VisionApiResponse, BoxScoreData, PlayerData, TeamData } from '@/types';

export class BoxScoreParser {
  private textBlocks: VisionApiResponse[] = [];

  constructor(textBlocks: VisionApiResponse[]) {
    this.textBlocks = textBlocks;
  }

  parse(): BoxScoreData {
    const fullText = this.textBlocks.map(block => block.text).join(' ');
    
    // Extract team names and scores
    const teamInfo = this.extractTeamInfo(fullText);
    
    // Extract player statistics
    const players = this.extractPlayerStats(fullText);
    
    // Extract team statistics
    const teams = this.extractTeamStats(fullText, teamInfo);

    return {
      homeTeam: teamInfo.homeTeam,
      awayTeam: teamInfo.awayTeam,
      homeScore: teamInfo.homeScore,
      awayScore: teamInfo.awayScore,
      players,
      teams,
    };
  }

  private extractTeamInfo(text: string): { homeTeam: string; awayTeam: string; homeScore: number; awayScore: number } {
    // Common NBA team patterns
    const teamPatterns = [
      'Lakers', 'Celtics', 'Warriors', 'Bulls', 'Heat', 'Knicks', 'Nets', 'Clippers',
      'Suns', 'Bucks', 'Nuggets', '76ers', 'Trail Blazers', 'Jazz', 'Rockets',
      'Mavericks', 'Spurs', 'Thunder', 'Pelicans', 'Grizzlies', 'Timberwolves',
      'Kings', 'Hornets', 'Magic', 'Pistons', 'Cavaliers', 'Pacers', 'Hawks',
      'Wizards', 'Raptors', 'Knicks'
    ];

    let homeTeam = '';
    let awayTeam = '';
    let homeScore = 0;
    let awayScore = 0;

    // Look for score patterns (e.g., "Lakers 108 - 95 Celtics")
    const scorePattern = /(\w+)\s+(\d+)\s*[-–]\s*(\d+)\s+(\w+)/i;
    const match = text.match(scorePattern);
    
    if (match) {
      const [, team1, score1, score2, team2] = match;
      const score1Num = parseInt(score1 || '0');
      const score2Num = parseInt(score2 || '0');
      
      // Determine which team is home/away based on score order or context
      if (score1Num > score2Num) {
        homeTeam = team1 || 'Unknown Team';
        awayTeam = team2 || 'Unknown Team';
        homeScore = score1Num;
        awayScore = score2Num;
      } else {
        homeTeam = team2 || 'Unknown Team';
        awayTeam = team1 || 'Unknown Team';
        homeScore = score2Num;
        awayScore = score1Num;
      }
    } else {
      // Fallback: look for team names in the text
      for (const team of teamPatterns) {
        if (text.includes(team)) {
          if (!homeTeam) {
            homeTeam = team;
          } else if (!awayTeam) {
            awayTeam = team;
            break;
          }
        }
      }
    }

    return { homeTeam, awayTeam, homeScore, awayScore };
  }

  private extractPlayerStats(text: string): PlayerData[] {
    const players: PlayerData[] = [];
    
    // Split text into lines and look for player statistics
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    
    for (const line of lines) {
      const playerData = this.parsePlayerLine(line);
      if (playerData) {
        players.push(playerData);
      }
    }

    return players;
  }

  private parsePlayerLine(line: string): PlayerData | null {
    // Pattern for player statistics line
    // Example: "LeBron James 25 8 10 2 1 3 2 10-18 55.6 2-5 40.0 3-4 75.0 +15"
    const playerPattern = /^([A-Za-z\s]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)-(\d+)\s+([\d.]+)\s+(\d+)-(\d+)\s+([\d.]+)\s+(\d+)-(\d+)\s+([\d.]+)\s+([+-]\d+)/;
    
    const match = line.match(playerPattern);
    if (!match) return null;

    const [
      , name, points, rebounds, assists, steals, blocks, turnovers, fouls,
      fgMade, fgAttempted, fgPercentage, threeMade, threeAttempted, threePercentage,
      ftMade, ftAttempted, ftPercentage, plusMinus
    ] = match;

    // Determine team based on context (this is a simplified approach)
    const team = this.determineTeamFromContext(name || 'Unknown Player');

    return {
      name: (name || 'Unknown Player').trim(),
      team,
      points: parseInt(points || '0'),
      rebounds: parseInt(rebounds || '0'),
      assists: parseInt(assists || '0'),
      steals: parseInt(steals || '0'),
      blocks: parseInt(blocks || '0'),
      turnovers: parseInt(turnovers || '0'),
      fouls: parseInt(fouls || '0'),
      fgMade: parseInt(fgMade || '0'),
      fgAttempted: parseInt(fgAttempted || '0'),
      fgPercentage: parseFloat(fgPercentage || '0'),
      threeMade: parseInt(threeMade || '0'),
      threeAttempted: parseInt(threeAttempted || '0'),
      threePercentage: parseFloat(threePercentage || '0'),
      ftMade: parseInt(ftMade || '0'),
      ftAttempted: parseInt(ftAttempted || '0'),
      ftPercentage: parseFloat(ftPercentage || '0'),
      plusMinus: parseInt(plusMinus || '0'),
    };
  }

  private determineTeamFromContext(playerName: string): string {
    // This is a simplified approach - in a real implementation,
    // you'd need more sophisticated logic based on the image layout
    // For now, we'll return a default team
    return 'Unknown Team';
  }

  private extractTeamStats(text: string, teamInfo: { homeTeam: string; awayTeam: string }): TeamData[] {
    const teams: TeamData[] = [];
    
    // Extract team totals from the text
    // This is a simplified implementation - real parsing would be more complex
    const homeTeamStats = this.parseTeamStats(text, teamInfo.homeTeam, true);
    const awayTeamStats = this.parseTeamStats(text, teamInfo.awayTeam, false);
    
    if (homeTeamStats) teams.push(homeTeamStats);
    if (awayTeamStats) teams.push(awayTeamStats);
    
    return teams;
  }

  private parseTeamStats(text: string, teamName: string, isHome: boolean): TeamData | null {
    // Look for team totals in the text
    // This is a simplified pattern - real implementation would be more sophisticated
    const teamPattern = new RegExp(`${teamName}\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)-(\d+)\\s+([\\d.]+)\\s+(\\d+)-(\d+)\\s+([\\d.]+)\\s+(\\d+)-(\d+)\\s+([\\d.]+)`, 'i');
    
    const match = text.match(teamPattern);
    if (!match) return null;

    const [
      , points, rebounds, assists, steals, blocks, turnovers, fouls,
      fgMade, fgAttempted, fgPercentage, threeMade, threeAttempted, threePercentage,
      ftMade, ftAttempted, ftPercentage
    ] = match;

    return {
      name: teamName,
      isHome,
      points: parseInt(points || '0'),
      rebounds: parseInt(rebounds || '0'),
      assists: parseInt(assists || '0'),
      steals: parseInt(steals || '0'),
      blocks: parseInt(blocks || '0'),
      turnovers: parseInt(turnovers || '0'),
      fouls: parseInt(fouls || '0'),
      fgMade: parseInt(fgMade || '0'),
      fgAttempted: parseInt(fgAttempted || '0'),
      fgPercentage: parseFloat(fgPercentage || '0'),
      threeMade: parseInt(threeMade || '0'),
      threeAttempted: parseInt(threeAttempted || '0'),
      threePercentage: parseFloat(threePercentage || '0'),
      ftMade: parseInt(ftMade || '0'),
      ftAttempted: parseInt(ftAttempted || '0'),
      ftPercentage: parseFloat(ftPercentage || '0'),
    };
  }
}

export default BoxScoreParser;
