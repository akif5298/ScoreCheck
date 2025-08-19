// Example usage of the VisionService
// This file demonstrates how to use the new dedicated vision service

import { VisionService } from './visionService';

// Example 1: Extract structured data from an image buffer
async function processImageBuffer(imageBuffer: Buffer) {
  try {
    const visionService = new VisionService();
    // This will extract rows formatted like:
    // PLAYER_NAME, TEAMMATE_GRADE, PTS, REBS, ASSISTS, STEALS, BLOCKS, FOULS, TURNOVERS, FGM/FGA, 3PM/3PA, FTM/FTA
    const extractedRows = await visionService.extractStructuredDataFromImage(imageBuffer);
    
    console.log('Extracted rows:', extractedRows);
    
    // Each row contains:
    // - playerName: string
    // - teammateGrade: string
    // - points: number
    // - rebounds: number
    // - assists: number
    // - steals: number
    // - blocks: number
    // - fouls: number
    // - turnovers: number
    // - fgMade: number
    // - fgAttempted: number
    // - threeMade: number
    // - threeAttempted: number
    // - ftMade: number
    // - ftAttempted: number
    
    return extractedRows;
  } catch (error) {
    console.error('Error processing image:', error);
    throw error;
  }
}

// Example 2: Extract structured data from an image URL
// Note: VisionService only supports Buffer input directly
// You would need to download the image first or use a different approach
async function processImageUrl(imageUrl: string) {
  try {
    console.log('VisionService requires Buffer input, not URLs directly');
    console.log('Use processImageBuffer() instead for Buffer input');
    console.log('Or download the image first and convert to Buffer');
    return null;
  } catch (error) {
    console.error('Error processing image URL:', error);
    throw error;
  }
}

// Example 3: Use with BoxScoreParser
import BoxScoreParser from './boxScoreParser';

async function processWithParser(imageBuffer: Buffer) {
  try {
    const visionService = new VisionService();
    // Extract structured data as ExtractedRow[]
    const extractedRows = await visionService.extractStructuredRowsFromImage(imageBuffer);
    
    // Parse into box score format
    const parser = new BoxScoreParser(extractedRows, 'example.jpg');
    const boxScoreData = parser.parse();
    
    console.log('Box score data:', boxScoreData);
    return boxScoreData;
  } catch (error) {
    console.error('Error processing with parser:', error);
    throw error;
  }
}

export {
  processImageBuffer,
  processImageUrl,
  processWithParser
};
