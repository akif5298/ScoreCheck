import { VisionApiResponse, ExtractedRow } from '../types';

export class MockVisionService {
  async extractTextFromImage(imageBuffer: Buffer): Promise<VisionApiResponse[]> {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Return mock extracted text that simulates what would come from a real box score
    return [
      {
        text: "LeBron James",
        confidence: 0.95,
        boundingBox: { vertices: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 120 }, { x: 100, y: 120 }] }
      },
      {
        text: "A+",
        confidence: 0.90,
        boundingBox: { vertices: [{ x: 250, y: 100 }, { x: 280, y: 100 }, { x: 280, y: 120 }, { x: 250, y: 120 }] }
      },
      {
        text: "28",
        confidence: 0.95,
        boundingBox: { vertices: [{ x: 300, y: 100 }, { x: 330, y: 100 }, { x: 330, y: 120 }, { x: 300, y: 120 }] }
      },
      {
        text: "8",
        confidence: 0.90,
        boundingBox: { vertices: [{ x: 350, y: 100 }, { x: 370, y: 100 }, { x: 370, y: 120 }, { x: 350, y: 120 }] }
      },
      {
        text: "12",
        confidence: 0.90,
        boundingBox: { vertices: [{ x: 400, y: 100 }, { x: 430, y: 100 }, { x: 430, y: 120 }, { x: 400, y: 120 }] }
      },
      {
        text: "2",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 450, y: 100 }, { x: 470, y: 100 }, { x: 470, y: 120 }, { x: 450, y: 120 }] }
      },
      {
        text: "1",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 500, y: 100 }, { x: 520, y: 100 }, { x: 520, y: 120 }, { x: 500, y: 120 }] }
      },
      {
        text: "3",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 550, y: 100 }, { x: 570, y: 100 }, { x: 570, y: 120 }, { x: 550, y: 120 }] }
      },
      {
        text: "2",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 600, y: 100 }, { x: 620, y: 100 }, { x: 620, y: 120 }, { x: 600, y: 120 }] }
      },
      {
        text: "10",
        confidence: 0.90,
        boundingBox: { vertices: [{ x: 650, y: 100 }, { x: 680, y: 100 }, { x: 680, y: 120 }, { x: 650, y: 120 }] }
      },
      {
        text: "18",
        confidence: 0.90,
        boundingBox: { vertices: [{ x: 700, y: 100 }, { x: 730, y: 100 }, { x: 730, y: 120 }, { x: 700, y: 120 }] }
      },
      {
        text: "4",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 750, y: 100 }, { x: 770, y: 100 }, { x: 770, y: 120 }, { x: 750, y: 120 }] }
      },
      {
        text: "6",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 800, y: 100 }, { x: 820, y: 100 }, { x: 820, y: 120 }, { x: 800, y: 120 }] }
      },
      {
        text: "8",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 850, y: 100 }, { x: 870, y: 100 }, { x: 870, y: 120 }, { x: 850, y: 120 }] }
      },
      {
        text: "Stephen Curry",
        confidence: 0.95,
        boundingBox: { vertices: [{ x: 100, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 170 }, { x: 100, y: 170 }] }
      },
      {
        text: "A",
        confidence: 0.90,
        boundingBox: { vertices: [{ x: 250, y: 150 }, { x: 280, y: 150 }, { x: 280, y: 170 }, { x: 250, y: 170 }] }
      },
      {
        text: "32",
        confidence: 0.95,
        boundingBox: { vertices: [{ x: 300, y: 150 }, { x: 330, y: 150 }, { x: 330, y: 170 }, { x: 300, y: 170 }] }
      },
      {
        text: "5",
        confidence: 0.90,
        boundingBox: { vertices: [{ x: 350, y: 150 }, { x: 370, y: 150 }, { x: 370, y: 170 }, { x: 350, y: 170 }] }
      },
      {
        text: "8",
        confidence: 0.90,
        boundingBox: { vertices: [{ x: 400, y: 150 }, { x: 430, y: 150 }, { x: 430, y: 170 }, { x: 400, y: 170 }] }
      },
      {
        text: "1",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 450, y: 150 }, { x: 470, y: 150 }, { x: 470, y: 170 }, { x: 450, y: 170 }] }
      },
      {
        text: "0",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 500, y: 150 }, { x: 520, y: 150 }, { x: 520, y: 170 }, { x: 500, y: 170 }] }
      },
      {
        text: "2",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 550, y: 150 }, { x: 570, y: 150 }, { x: 570, y: 170 }, { x: 550, y: 170 }] }
      },
      {
        text: "1",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 600, y: 150 }, { x: 620, y: 150 }, { x: 620, y: 170 }, { x: 600, y: 170 }] }
      },
      {
        text: "12",
        confidence: 0.90,
        boundingBox: { vertices: [{ x: 650, y: 150 }, { x: 680, y: 150 }, { x: 680, y: 170 }, { x: 650, y: 170 }] }
      },
      {
        text: "20",
        confidence: 0.90,
        boundingBox: { vertices: [{ x: 700, y: 150 }, { x: 730, y: 150 }, { x: 730, y: 170 }, { x: 700, y: 170 }] }
      },
      {
        text: "6",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 750, y: 150 }, { x: 770, y: 150 }, { x: 770, y: 170 }, { x: 750, y: 170 }] }
      },
      {
        text: "8",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 800, y: 150 }, { x: 820, y: 150 }, { x: 820, y: 170 }, { x: 800, y: 170 }] }
      },
      {
        text: "10",
        confidence: 0.85,
        boundingBox: { vertices: [{ x: 850, y: 150 }, { x: 870, y: 150 }, { x: 870, y: 170 }, { x: 800, y: 170 }] }
      }
    ];
  }

  async extractTextFromImageUrl(imageUrl: string): Promise<VisionApiResponse[]> {
    return this.extractTextFromImage(Buffer.from('mock'));
  }

  extractStructuredRows(textBlocks: VisionApiResponse[]): ExtractedRow[] {
    const rows: ExtractedRow[] = [];
    
    // Process text blocks in groups of 14 (one row per player)
    for (let i = 0; i < textBlocks.length; i += 14) {
      const rowBlocks = textBlocks.slice(i, i + 14);
      if (rowBlocks.length >= 14) {
        const row = this.parseRow(rowBlocks);
        if (row) {
          rows.push(row);
        }
      }
    }
    
    return rows;
  }

  private parseRow(blocks: VisionApiResponse[]): ExtractedRow | null {
    try {
      // Extract values from the blocks - ensure we don't access out of bounds
      const playerName = blocks[0]?.text || '';
      const teammateGrade = blocks[1]?.text || '';
      const points = this.parseNumber(blocks[2]?.text || '0');
      const rebounds = this.parseNumber(blocks[3]?.text || '0');
      const assists = this.parseNumber(blocks[4]?.text || '0');
      const steals = this.parseNumber(blocks[5]?.text || '0');
      const blocksCount = this.parseNumber(blocks[6]?.text || '0');
      const fouls = this.parseNumber(blocks[7]?.text || '0');
      const turnovers = this.parseNumber(blocks[8]?.text || '0');
      const fgMade = this.parseNumber(blocks[9]?.text || '0');
      const fgAttempted = this.parseNumber(blocks[10]?.text || '0');
      const threeMade = this.parseNumber(blocks[11]?.text || '0');
      const threeAttempted = this.parseNumber(blocks[12]?.text || '0');
      const ftMade = this.parseNumber(blocks[13]?.text || '0');
      // Note: ftAttempted would be at index 14, but our mock data only has 14 elements (0-13)
      // So we'll use a default value or skip this field
      const ftAttempted = 0; // Default value since we don't have this data in our mock

      // Mock team assignment based on row index (first 5 = Team A, last 5 = Team B)
      const team = 'Team A'; // Default to Team A for mock data

      return {
        playerName,
        team, // ✅ Add team property
        teammateGrade,
        points: points || 0,
        rebounds: rebounds || 0,
        assists: assists || 0,
        steals: steals || 0,
        blocks: blocksCount || 0,
        fouls: fouls || 0,
        turnovers: turnovers || 0,
        fgMade: fgMade || 0,
        fgAttempted: fgAttempted || 0,
        threeMade: threeMade || 0,
        threeAttempted: threeAttempted || 0,
        ftMade: ftMade || 0,
        ftAttempted: ftAttempted || 0,
      };
    } catch (error) {
      console.error('Error parsing row:', error);
      return null;
    }
  }

  private parseNumber(value: string): number | null {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }

  async extractStructuredDataFromImage(imageBuffer: Buffer): Promise<ExtractedRow[]> {
    const textBlocks = await this.extractTextFromImage(imageBuffer);
    return this.extractStructuredRows(textBlocks);
  }

  async extractStructuredDataFromImageUrl(imageUrl: string): Promise<ExtractedRow[]> {
    const textBlocks = await this.extractTextFromImageUrl(imageUrl);
    return this.extractStructuredRows(textBlocks);
  }
}

export default new MockVisionService();
