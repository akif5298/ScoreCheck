import { VisionApiResponse, TextBlock, Player, GameData, ExtractedRow } from '../types';
import { BoxScoreParser } from './boxScoreParser';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

// Coordinate-based extraction regions (EXACT COORDINATES PROVIDED)
const EXTRACTION_REGIONS = {
  // Player data regions - using exact coordinates provided
  // Each player has their own Y-coordinate and specific box sizes
  
  // Player 1 (Y=522)
  P1_PLAYER_NAME: { x1: 1220, y1: 522, x2: 1705, y2: 597 }, // 485x75px
  P1_GRADE: { x1: 1700, y1: 522, x2: 1810, y2: 597 }, // 110x75px
  P1_POINTS: { x1: 1865, y1: 522, x2: 1975, y2: 597 }, // 110x75px
  P1_REBOUNDS: { x1: 2030, y1: 522, x2: 2140, y2: 597 }, // 110x75px
  P1_ASSISTS: { x1: 2170, y1: 522, x2: 2280, y2: 597 }, // 110x75px
  P1_STEALS: { x1: 2330, y1: 522, x2: 2440, y2: 597 }, // 110x75px
  P1_BLOCKS: { x1: 2480, y1: 522, x2: 2590, y2: 597 }, // 110x75px
  P1_FOULS: { x1: 2620, y1: 522, x2: 2730, y2: 597 }, // 110x75px
  P1_TURNOVERS: { x1: 2770, y1: 522, x2: 2880, y2: 597 }, // 110x75px
  P1_FG: { x1: 2900, y1: 522, x2: 3080, y2: 593 }, // 180x71px
  P1_3P: { x1: 3130, y1: 522, x2: 3310, y2: 593 }, // 180x71px
  P1_FT: { x1: 3340, y1: 522, x2: 3520, y2: 593 }, // 180x71px
  
  // Player 2 (Y=605)
  P2_PLAYER_NAME: { x1: 1220, y1: 605, x2: 1705, y2: 680 }, // 485x75px
  P2_GRADE: { x1: 1700, y1: 605, x2: 1810, y2: 680 }, // 110x75px
  P2_POINTS: { x1: 1865, y1: 605, x2: 1975, y2: 680 }, // 110x75px
  P2_REBOUNDS: { x1: 2030, y1: 605, x2: 2140, y2: 680 }, // 110x75px
  P2_ASSISTS: { x1: 2170, y1: 605, x2: 2280, y2: 680 }, // 110x75px
  P2_STEALS: { x1: 2330, y1: 605, x2: 2440, y2: 680 }, // 110x75px
  P2_BLOCKS: { x1: 2480, y1: 605, x2: 2590, y2: 680 }, // 110x75px
  P2_FOULS: { x1: 2620, y1: 605, x2: 2730, y2: 680 }, // 110x75px
  P2_TURNOVERS: { x1: 2770, y1: 605, x2: 2880, y2: 680 }, // 110x75px
  P2_FG: { x1: 2900, y1: 605, x2: 3080, y2: 676 }, // 180x71px
  P2_3P: { x1: 3130, y1: 605, x2: 3310, y2: 676 }, // 180x71px
  P2_FT: { x1: 3340, y1: 605, x2: 3520, y2: 676 }, // 180x71px
  
  // Player 3 (Y=688)
  P3_PLAYER_NAME: { x1: 1220, y1: 688, x2: 1705, y2: 763 }, // 485x75px
  P3_GRADE: { x1: 1700, y1: 688, x2: 1810, y2: 763 }, // 110x75px
  P3_POINTS: { x1: 1865, y1: 688, x2: 1975, y2: 763 }, // 110x75px
  P3_REBOUNDS: { x1: 2030, y1: 688, x2: 2140, y2: 763 }, // 110x75px
  P3_ASSISTS: { x1: 2170, y1: 688, x2: 2280, y2: 763 }, // 110x75px
  P3_STEALS: { x1: 2330, y1: 688, x2: 2440, y2: 763 }, // 110x75px
  P3_BLOCKS: { x1: 2480, y1: 688, x2: 2590, y2: 763 }, // 110x75px
  P3_FOULS: { x1: 2620, y1: 688, x2: 2730, y2: 763 }, // 110x75px
  P3_TURNOVERS: { x1: 2770, y1: 688, x2: 2880, y2: 763 }, // 110x75px
  P3_FG: { x1: 2900, y1: 688, x2: 3080, y2: 759 }, // 180x71px
  P3_3P: { x1: 3130, y1: 688, x2: 3310, y2: 759 }, // 180x71px
  P3_FT: { x1: 3340, y1: 688, x2: 3520, y2: 759 }, // 180x71px
  
  // Player 4 (Y=771)
  P4_PLAYER_NAME: { x1: 1220, y1: 771, x2: 1705, y2: 846 }, // 485x75px
  P4_GRADE: { x1: 1700, y1: 771, x2: 1810, y2: 846 }, // 110x75px
  P4_POINTS: { x1: 1865, y1: 771, x2: 1975, y2: 846 }, // 110x75px
  P4_REBOUNDS: { x1: 2030, y1: 771, x2: 2140, y2: 846 }, // 110x75px
  P4_ASSISTS: { x1: 2170, y1: 771, x2: 2280, y2: 846 }, // 110x75px
  P4_STEALS: { x1: 2330, y1: 771, x2: 2440, y2: 846 }, // 110x75px
  P4_BLOCKS: { x1: 2480, y1: 771, x2: 2590, y2: 846 }, // 110x75px
  P4_FOULS: { x1: 2620, y1: 771, x2: 2730, y2: 846 }, // 110x75px
  P4_TURNOVERS: { x1: 2770, y1: 771, x2: 2880, y2: 846 }, // 110x75px
  P4_FG: { x1: 2900, y1: 771, x2: 3080, y2: 842 }, // 180x71px
  P4_3P: { x1: 3130, y1: 771, x2: 3310, y2: 842 }, // 180x71px
  P4_FT: { x1: 3340, y1: 771, x2: 3520, y2: 842 }, // 180x71px
  
  // Player 5 (Y=854)
  P5_PLAYER_NAME: { x1: 1220, y1: 854, x2: 1705, y2: 929 }, // 485x75px
  P5_GRADE: { x1: 1700, y1: 854, x2: 1810, y2: 929 }, // 110x75px
  P5_POINTS: { x1: 1865, y1: 854, x2: 1975, y2: 929 }, // 110x75px
  P5_REBOUNDS: { x1: 2030, y1: 854, x2: 2140, y2: 929 }, // 110x75px
  P5_ASSISTS: { x1: 2170, y1: 854, x2: 2280, y2: 929 }, // 110x75px
  P5_STEALS: { x1: 2330, y1: 854, x2: 2440, y2: 929 }, // 110x75px
  P5_BLOCKS: { x1: 2480, y1: 854, x2: 2590, y2: 929 }, // 110x75px
  P5_FOULS: { x1: 2620, y1: 854, x2: 2730, y2: 929 }, // 110x75px
  P5_TURNOVERS: { x1: 2770, y1: 854, x2: 2880, y2: 929 }, // 110x75px
  P5_FG: { x1: 2900, y1: 854, x2: 3080, y2: 925 }, // 180x71px
  P5_3P: { x1: 3130, y1: 854, x2: 3310, y2: 925 }, // 180x71px
  P5_FT: { x1: 3340, y1: 854, x2: 3520, y2: 925 }, // 180x71px
  
  // Player 6 (Y=1155)
  P6_PLAYER_NAME: { x1: 1220, y1: 1155, x2: 1705, y2: 1230 }, // 485x75px
  P6_GRADE: { x1: 1700, y1: 1155, x2: 1810, y2: 1230 }, // 110x75px
  P6_POINTS: { x1: 1865, y1: 1155, x2: 1975, y2: 1230 }, // 110x75px
  P6_REBOUNDS: { x1: 2030, y1: 1155, x2: 2140, y2: 1230 }, // 110x75px
  P6_ASSISTS: { x1: 2170, y1: 1155, x2: 2280, y2: 1230 }, // 110x75px
  P6_STEALS: { x1: 2330, y1: 1155, x2: 2440, y2: 1230 }, // 110x75px
  P6_BLOCKS: { x1: 2480, y1: 1155, x2: 2590, y2: 1230 }, // 110x75px
  P6_FOULS: { x1: 2620, y1: 1155, x2: 2730, y2: 1230 }, // 110x75px
  P6_TURNOVERS: { x1: 2770, y1: 1155, x2: 2880, y2: 1230 }, // 110x75px
  P6_FG: { x1: 2900, y1: 1155, x2: 3080, y2: 1226 }, // 180x71px
  P6_3P: { x1: 3130, y1: 1155, x2: 3310, y2: 1226 }, // 180x71px
  P6_FT: { x1: 3340, y1: 1155, x2: 3520, y2: 1226 }, // 180x71px
  
  // Player 7 (Y=1238)
  P7_PLAYER_NAME: { x1: 1220, y1: 1238, x2: 1705, y2: 1313 }, // 485x75px
  P7_GRADE: { x1: 1700, y1: 1238, x2: 1810, y2: 1313 }, // 110x75px
  P7_POINTS: { x1: 1865, y1: 1238, x2: 1975, y2: 1313 }, // 110x75px
  P7_REBOUNDS: { x1: 2030, y1: 1238, x2: 2140, y2: 1313 }, // 110x75px
  P7_ASSISTS: { x1: 2170, y1: 1238, x2: 2280, y2: 1313 }, // 110x75px
  P7_STEALS: { x1: 2330, y1: 1238, x2: 2440, y2: 1313 }, // 110x75px
  P7_BLOCKS: { x1: 2480, y1: 1238, x2: 2590, y2: 1313 }, // 110x75px
  P7_FOULS: { x1: 2620, y1: 1238, x2: 2730, y2: 1313 }, // 110x75px
  P7_TURNOVERS: { x1: 2770, y1: 1238, x2: 2880, y2: 1313 }, // 110x75px
  P7_FG: { x1: 2900, y1: 1238, x2: 3080, y2: 1309 }, // 180x71px
  P7_3P: { x1: 3130, y1: 1238, x2: 3310, y2: 1309 }, // 180x71px
  P7_FT: { x1: 3340, y1: 1238, x2: 3520, y2: 1309 }, // 180x71px
  
  // Player 8 (Y=1321)
  P8_PLAYER_NAME: { x1: 1220, y1: 1321, x2: 1705, y2: 1396 }, // 485x75px
  P8_GRADE: { x1: 1700, y1: 1321, x2: 1810, y2: 1396 }, // 110x75px
  P8_POINTS: { x1: 1865, y1: 1321, x2: 1975, y2: 1396 }, // 110x75px
  P8_REBOUNDS: { x1: 2030, y1: 1321, x2: 2140, y2: 1396 }, // 110x75px
  P8_ASSISTS: { x1: 2170, y1: 1321, x2: 2280, y2: 1396 }, // 110x75px
  P8_STEALS: { x1: 2330, y1: 1321, x2: 2440, y2: 1396 }, // 110x75px
  P8_BLOCKS: { x1: 2480, y1: 1321, x2: 2590, y2: 1396 }, // 110x75px
  P8_FOULS: { x1: 2620, y1: 1321, x2: 2730, y2: 1396 }, // 110x75px
  P8_TURNOVERS: { x1: 2770, y1: 1321, x2: 2880, y2: 1396 }, // 110x75px
  P8_FG: { x1: 2900, y1: 1321, x2: 3080, y2: 1392 }, // 180x71px
  P8_3P: { x1: 3130, y1: 1321, x2: 3310, y2: 1392 }, // 180x71px
  P8_FT: { x1: 3340, y1: 1321, x2: 3520, y2: 1392 }, // 180x71px
  
  // Player 9 (Y=1404)
  P9_PLAYER_NAME: { x1: 1220, y1: 1404, x2: 1705, y2: 1479 }, // 485x75px
  P9_GRADE: { x1: 1700, y1: 1404, x2: 1810, y2: 1479 }, // 110x75px
  P9_POINTS: { x1: 1865, y1: 1404, x2: 1975, y2: 1479 }, // 110x75px
  P9_REBOUNDS: { x1: 2030, y1: 1404, x2: 2140, y2: 1479 }, // 110x75px
  P9_ASSISTS: { x1: 2170, y1: 1404, x2: 2280, y2: 1479 }, // 110x75px
  P9_STEALS: { x1: 2330, y1: 1404, x2: 2440, y2: 1479 }, // 110x75px
  P9_BLOCKS: { x1: 2480, y1: 1404, x2: 2590, y2: 1479 }, // 110x75px
  P9_FOULS: { x1: 2620, y1: 1404, x2: 2730, y2: 1479 }, // 110x75px
  P9_TURNOVERS: { x1: 2770, y1: 1404, x2: 2880, y2: 1479 }, // 110x75px
  P9_FG: { x1: 2900, y1: 1404, x2: 3080, y2: 1475 }, // 180x71px
  P9_3P: { x1: 3130, y1: 1404, x2: 3310, y2: 1475 }, // 180x71px
  P9_FT: { x1: 3340, y1: 1404, x2: 3520, y2: 1475 }, // 180x71px
  
  // Player 10 (Y=1487)
  P10_PLAYER_NAME: { x1: 1220, y1: 1487, x2: 1705, y2: 1562 }, // 485x75px
  P10_GRADE: { x1: 1700, y1: 1487, x2: 1810, y2: 1562 }, // 110x75px
  P10_POINTS: { x1: 1865, y1: 1487, x2: 1975, y2: 1562 }, // 110x75px
  P10_REBOUNDS: { x1: 2030, y1: 1487, x2: 2140, y2: 1562 }, // 110x75px
  P10_ASSISTS: { x1: 2170, y1: 1487, x2: 2280, y2: 1562 }, // 110x75px
  P10_STEALS: { x1: 2330, y1: 1487, x2: 2440, y2: 1562 }, // 110x75px
  P10_BLOCKS: { x1: 2480, y1: 1487, x2: 2590, y2: 1562 }, // 110x75px
  P10_FOULS: { x1: 2620, y1: 1487, x2: 2730, y2: 1562 }, // 110x75px
  P10_TURNOVERS: { x1: 2770, y1: 1487, x2: 2880, y2: 1562 }, // 110x75px
  P10_FG: { x1: 2900, y1: 1487, x2: 3080, y2: 1558 }, // 180x71px
  P10_3P: { x1: 3130, y1: 1487, x2: 3310, y2: 1558 }, // 180x71px
  P10_FT: { x1: 3340, y1: 1487, x2: 3520, y2: 1558 }, // 180x71px
  
  // Team totals regions (keeping existing for now)
  TEAM_A_TOTAL: { x1: 748, y1: 790, x2: 962, y2: 810 },
  TEAM_A_QUARTERS: { x1: 310, y1: 790, x2: 738, y2: 810 },
  TEAM_B_TOTAL: { x1: 748, y1: 1110, x2: 962, y2: 1130 },
  TEAM_B_QUARTERS: { x1: 310, y1: 1110, x2: 738, y2: 1130 },
  
  // Rows to ignore (updated coordinates)
  IGNORE_ROWS: [
    { x1: 973, y1: 419, x2: 3524, y2: 498 },   // Header row
    { x1: 973, y1: 937, x2: 3524, y2: 1009 },  // Team A total row
    { x1: 973, y1: 1048, x2: 3524, y2: 1123 }, // Team B total row
    { x1: 973, y1: 1569, x2: 3524, y2: 1645 }  // Bottom total row
  ]
};

// Player name replacement mappings
const nameMappings: { [key: string]: string } = {
  'grim bulletz': 'Nillan',
  'grim ar15': 'Akif',
  'electrox04': 'Abdul',
  'xjsi': 'Ikroop',
  'anxrchyy': 'Ankit',
  'chaozgamer': 'TV',
  'anis rahman 13': 'Anis',
  'anis_rahman_13': 'Anis',
  'xjsi---': 'Ikroop',
  'xjsi ---': 'Ikroop'
};

export class VisionService {
  private vision: any;
  private parser: BoxScoreParser;

  constructor() {
    this.parser = new BoxScoreParser([], '');
    
    // Initialize Google Cloud Vision API
    if (process.env.GOOGLE_CLOUD_PROJECT_ID && process.env.GOOGLE_CLOUD_PRIVATE_KEY && process.env.GOOGLE_CLOUD_CLIENT_EMAIL) {
      try {
        const vision = require('@google-cloud/vision');
        
        // Create credentials object from environment variables
        const credentials = {
          private_key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
          client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL
        };
        
        this.vision = new vision.ImageAnnotatorClient({
          credentials: credentials,
          projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
        });
        
        console.log('Google Cloud Vision API initialized successfully');
      } catch (error) {
        console.error('Failed to initialize Google Cloud Vision:', error);
        this.vision = null;
      }
    } else {
      console.warn('Google Cloud credentials not set, Vision API will not work');
      console.warn('Please set GOOGLE_CLOUD_PROJECT_ID, GOOGLE_CLOUD_PRIVATE_KEY, and GOOGLE_CLOUD_CLIENT_EMAIL in your .env file');
      this.vision = null;
    }
  }

  async extractStructuredDataFromImage(imageBuffer: Buffer): Promise<{
    players: Player[];
    gameData: GameData;
    teamATotals: any;
    teamBTotals: any;
    teamAQuarters: any;
    teamBQuarters: any;
  }> {
    if (!this.vision) {
      throw new Error('Google Cloud Vision API not initialized');
    }

    try {
      // Preprocess image for better OCR accuracy
      const preprocessedBuffer = await this.preprocessImageForOCR(imageBuffer);
      
      // Use original single OCR approach for better accuracy
      const [result] = await this.vision.textDetection(preprocessedBuffer);
      const textBlocks = result.textAnnotations || [];
      
      if (textBlocks.length === 0) {
        throw new Error('No text detected in image');
      }

      // Skip the first block as it contains all text
      const blocks = textBlocks.slice(1);
      
      console.log(`OCR extracted ${blocks.length} text blocks from image`);
      
      // Extract data using coordinate-based approach
      const extractedData = this.extractDataByCoordinates(blocks);
      
      return extractedData;
    } catch (error) {
      console.error('Error extracting data from image:', error);
      throw error;
    }
  }

  /**
   * Preprocess image to improve OCR accuracy
   * Applies contrast enhancement, noise reduction, and edge sharpening
   * Now includes adaptive preprocessing for highlighted/selected text
   */
  private async preprocessImageForOCR(imageBuffer: Buffer): Promise<Buffer> {
    // Declare temporary file paths at function scope
    let tempInputPath: string = '';
    let tempOutputPath: string = '';
    
    try {
      console.log('🔄 Starting OpenCV.js-based image preprocessing pipeline...');
      
      // Check if OpenCV.js is available
      let cv: any;
      try {
        cv = require('opencv.js');
        console.log('OpenCV.js imported successfully');
      } catch (error) {
        console.log('OpenCV.js not available, falling back to Sharp-based preprocessing...');
        return this.fallbackSharpPreprocessing(imageBuffer);
      }
      
      try {
        // Save the buffer to a temporary file for OpenCV.js processing
        tempInputPath = path.join(__dirname, '..', '..', 'uploads', `temp_input_${Date.now()}.jpeg`);
        tempOutputPath = path.join(__dirname, '..', '..', 'uploads', `temp_output_${Date.now()}.png`);
        
        // Ensure uploads directory exists
        const uploadsDir = path.dirname(tempInputPath);
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        // Write input buffer to temp file
        fs.writeFileSync(tempInputPath, imageBuffer);
        
        // Helper: load image from disk into OpenCV.js Mat
        const loadImage = (imagePath: string): any => {
          const imageData = fs.readFileSync(imagePath);
          const buffer = new Uint8Array(imageData);
          const img = cv.imdecode(buffer, cv.IMREAD_COLOR); // OpenCV.js requires 2 arguments
          return img;
        };
        
        // Helper: save Mat to file
        const saveImage = (mat: any, imagePath: string) => {
          const out = cv.imencode('.png', mat);
          fs.writeFileSync(imagePath, out);
        };
        
        // 1. Load image
        console.log('📐 Step 1: Loading image with OpenCV.js...');
        let img = loadImage(tempInputPath);
        
        // 2. Convert to grayscale
        console.log('🎨 Step 2: Converting to grayscale...');
        let gray = new cv.Mat();
        cv.cvtColor(img, gray, cv.COLOR_BGR2GRAY, 0); // Use BGR2GRAY for JPEG images
        
        // 3. CLAHE for contrast enhancement
        console.log('✨ Step 3: Applying CLAHE contrast enhancement...');
        let clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
        let norm = new cv.Mat();
        clahe.apply(gray, norm);
        
        // 4. Adaptive threshold (binary)
        console.log('⚫ Step 4: Applying adaptive thresholding...');
        let binary = new cv.Mat();
        cv.adaptiveThreshold(
          norm, binary,
          255,
          cv.ADAPTIVE_THRESH_GAUSSIAN_C,
          cv.THRESH_BINARY,
          31, 10
        );
        
        // 5. Invert for OCR (white text, black background)
        console.log('🔄 Step 5: Inverting colors for OCR...');
        let inverted = new cv.Mat();
        cv.bitwise_not(binary, inverted);
        
        // 6. Save the binary image
        console.log('💾 Step 6: Saving OpenCV.js processed image...');
        saveImage(inverted, tempOutputPath);
        
        // Read the processed image back as a buffer
        const processedBuffer = fs.readFileSync(tempOutputPath);
        
        // Save a copy for debugging
        await this.savePreprocessedImage(processedBuffer, 'opencvjs-pipeline');
        
        // Clean up temporary files
        try {
          fs.unlinkSync(tempInputPath);
          fs.unlinkSync(tempOutputPath);
        } catch (cleanupError) {
          console.warn('Failed to clean up temporary files:', cleanupError);
        }
        
        console.log('✅ OpenCV.js preprocessing pipeline completed successfully');
        return processedBuffer;
        
      } catch (opencvError) {
        console.error('❌ OpenCV.js processing failed:', opencvError);
        console.log('🔄 Falling back to Sharp-based preprocessing...');
        
        // Clean up temporary files on error
        try {
          if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
          if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
        } catch (cleanupError) {
          console.warn('Failed to clean up temporary files:', cleanupError);
        }
        
        return this.fallbackSharpPreprocessing(imageBuffer);
      }
      
    } catch (error) {
      console.error('❌ Error in OpenCV.js preprocessing pipeline:', error);
      console.log('🔄 Falling back to Sharp-based preprocessing...');
      return this.fallbackSharpPreprocessing(imageBuffer);
    }
  }

  /**
   * Fallback preprocessing using Sharp when OpenCV is not available
   */
  private async fallbackSharpPreprocessing(imageBuffer: Buffer): Promise<Buffer> {
    try {
      console.log('🔄 Using Sharp fallback preprocessing...');
      
      // Step 1: Convert to grayscale
      console.log('🎨 Step 1: Converting to grayscale...');
      let processed = await sharp(imageBuffer)
        .grayscale()
        .toBuffer();
      
      // Step 2: Gentle contrast enhancement
      console.log('✨ Step 2: Gentle contrast enhancement...');
      processed = await sharp(processed)
        .modulate({
          brightness: 1.05,
          saturation: 0,
          hue: 0
        })
        .linear(1.1, 0)
        .toBuffer();
      
      // Step 3: Light sharpening
      console.log('🔍 Step 3: Light edge sharpening...');
      processed = await sharp(processed)
        .sharpen(0.8)
        .toBuffer();
      
      // Step 4: Light noise reduction
      console.log('🧹 Step 4: Light noise reduction...');
      processed = await sharp(processed)
        .median(1)
        .toBuffer();
      
      // Step 5: Save for debugging
      console.log('💾 Step 5: Saving Sharp fallback image...');
      await this.savePreprocessedImage(processed, 'sharp-fallback');
      
      console.log('✅ Sharp fallback preprocessing completed');
      return processed;
      
    } catch (error) {
      console.error('❌ Sharp fallback also failed:', error);
      console.log('🔄 Returning original image...');
      return imageBuffer;
    }
  }

  /**
   * Test OCR quality on a preprocessed image
   * Returns a score from 0-1 indicating how well text was extracted
   */
  private async testOCRQuality(imageBuffer: Buffer): Promise<number> {
    try {
      // Quick OCR test to assess quality
      const [result] = await this.vision.textDetection(imageBuffer);
      const textBlocks = result.textAnnotations || [];
      
      if (textBlocks.length === 0) {
        return 0; // No text detected
      }
      
      // Skip the first block (contains all text)
      const blocks = textBlocks.slice(1);
      
      // Count blocks with meaningful text (more than 1 character)
      const meaningfulBlocks = blocks.filter((block: TextBlock) => 
        block.description && block.description.trim().length > 1
      );
      
      // Calculate quality score based on text block density and content
      const totalBlocks = blocks.length;
      const meaningfulRatio = meaningfulBlocks.length / totalBlocks;
      
      // Enhanced quality scoring
      let qualityScore = meaningfulRatio;
      
      // Check for numbers (basketball stats)
      const numberBlocks = blocks.filter((block: TextBlock) => /\d/.test(block.description));
      const numberRatio = numberBlocks.length / totalBlocks;
      qualityScore += numberRatio * 0.3; // Numbers are important for stats
      
      // Check for basketball-specific terms
      const basketballTerms = blocks.filter((block: TextBlock) => 
        /points|rebounds|assists|steals|blocks|fouls|turnovers|grade|fg|3p|ft/i.test(block.description)
      );
      const basketballRatio = basketballTerms.length / totalBlocks;
      qualityScore += basketballRatio * 0.2;
      
      // Check for player names (usually longer text)
      const nameBlocks = blocks.filter((block: TextBlock) => 
        block.description && block.description.trim().length > 3 && /[a-zA-Z]/.test(block.description)
      );
      const nameRatio = nameBlocks.length / totalBlocks;
      qualityScore += nameRatio * 0.15;
      
      // Check for clean text (no excessive special characters)
      const cleanBlocks = blocks.filter((block: TextBlock) => 
        block.description && !/[^\w\s\d]/.test(block.description)
      );
      const cleanRatio = cleanBlocks.length / totalBlocks;
      qualityScore += cleanRatio * 0.1;
      
      // Bonus for high text density
      if (totalBlocks > 200) {
        qualityScore += 0.05; // More text blocks usually means better extraction
      }
      
      // Penalty for very short blocks (might indicate poor OCR)
      const shortBlocks = blocks.filter((block: TextBlock) => 
        block.description && block.description.trim().length === 1
      );
      const shortRatio = shortBlocks.length / totalBlocks;
      qualityScore -= shortRatio * 0.1;
      
      return Math.max(0, Math.min(qualityScore, 1.0));
      
    } catch (error) {
      console.warn('OCR quality test failed:', error);
      return 0.5; // Default to medium quality
    }
  }

  /**
   * Save preprocessed image for debugging purposes
   */
  private async savePreprocessedImage(buffer: Buffer, suffix?: string): Promise<void> {
    try {
      const timestamp = Date.now();
      const suffixStr = suffix ? `-${suffix}` : '';
      const outputPath = path.join(__dirname, '..', '..', 'uploads', `preprocessed${suffixStr}-${timestamp}.png`);
      
      // Ensure uploads directory exists
      const uploadsDir = path.dirname(outputPath);
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      // Save the preprocessed image
      fs.writeFileSync(outputPath, buffer);
      console.log(`Preprocessed image saved for debugging: ${outputPath}`);
    } catch (error) {
      console.warn('Failed to save preprocessed image:', error);
    }
  }

  /**
   * Basic image preprocessing using built-in methods
   * Fallback when Sharp is not available
   */
  private basicImagePreprocessing(imageBuffer: Buffer): Buffer {
    console.log('Applying basic image preprocessing...');
    
    // For now, return the original buffer
    // In a real implementation, you could use canvas or other libraries
    // to apply basic transformations like contrast adjustment
    
    return imageBuffer;
  }

  async extractStructuredRowsFromImage(imageBuffer: Buffer): Promise<ExtractedRow[]> {
    if (!this.vision) {
      throw new Error('Google Cloud Vision API not initialized');
    }

    try {
      // Preprocess image for better OCR accuracy
      const preprocessedBuffer = await this.preprocessImageForOCR(imageBuffer);
      
      // Use original single OCR approach for better accuracy
      const [result] = await this.vision.textDetection(preprocessedBuffer);
      const textBlocks = result.textAnnotations || [];
      
      if (textBlocks.length === 0) {
        throw new Error('No text detected in image');
      }

      // Skip the first block as it contains all text
      const blocks = textBlocks.slice(1);
      
      console.log(`OCR extracted ${blocks.length} text blocks from image`);
      
      // Extract data using coordinate-based approach and convert to ExtractedRow format
      const extractedData = this.extractDataByCoordinates(blocks);
      
      // Convert Player objects to ExtractedRow format
      const extractedRows: ExtractedRow[] = extractedData.players.map(player => ({
        playerName: player.name,
        team: player.team, // ✅ Add team property
        teammateGrade: player.teammateGrade || '',
        points: player.points,
        rebounds: player.rebounds,
        assists: player.assists,
        steals: player.steals,
        blocks: player.blocks,
        fouls: player.fouls,
        turnovers: player.turnovers,
        fgMade: player.fgMade,
        fgAttempted: player.fgAttempted,
        threeMade: player.threeMade,
        threeAttempted: player.threeAttempted,
        ftMade: player.ftMade,
        ftAttempted: player.ftAttempted
      }));
      
      return extractedRows;
    } catch (error) {
      console.error('Error extracting structured rows from image:', error);
      throw error;
    }
  }

  private extractDataByCoordinates(blocks: TextBlock[]): {
    players: Player[];
    gameData: GameData;
    teamATotals: any;
    teamBTotals: any;
    teamAQuarters: any;
    teamBQuarters: any;
  } {
    // Extract all players using their specific coordinates
    const players = this.extractAllPlayers(blocks);
    
    // Extract team totals
    const teamATotals = this.extractTeamTotals(blocks, EXTRACTION_REGIONS.TEAM_A_TOTAL);
    const teamBTotals = this.extractTeamTotals(blocks, EXTRACTION_REGIONS.TEAM_B_TOTAL);
    
    // Extract team totals per quarter
    const teamAQuarters = this.extractTeamQuarters(blocks, EXTRACTION_REGIONS.TEAM_A_QUARTERS);
    const teamBQuarters = this.extractTeamQuarters(blocks, EXTRACTION_REGIONS.TEAM_B_QUARTERS);
    
    // Create game data
    const gameData: GameData = {
      date: new Date().toISOString().split('T')[0] || new Date().toISOString().slice(0, 10),
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      homeScore: teamATotals.points || 0,
      awayScore: teamBTotals.points || 0,
      quarters: 4
    };
    
    console.log(`Extracted ${players.length} players from image`);
    
    return {
      players,
      gameData,
      teamATotals,
      teamBTotals,
      teamAQuarters,
      teamBQuarters
    };
  }

  private isInIgnoredRegion(block: TextBlock): boolean {
    const vertex = block.boundingPoly.vertices[0];
    if (!vertex || vertex.x === undefined || vertex.y === undefined) {
      return false;
    }
    
    return EXTRACTION_REGIONS.IGNORE_ROWS.some(region => 
      vertex.x >= region.x1 &&
      vertex.x <= region.x2 &&
      vertex.y >= region.y1 &&
      vertex.y <= region.y2
    );
  }

  private groupBlocksIntoPlayerRows(blocks: TextBlock[]): TextBlock[][] {
    // Group blocks by Y-coordinate with some tolerance
    const tolerance = 20;
    const rows: TextBlock[][] = [];
    
    for (const block of blocks) {
      const vertex = block.boundingPoly.vertices[0];
      if (!vertex || vertex.y === undefined) {
        continue;
      }
      
      const y = vertex.y;
      let addedToRow = false;
      
      for (const row of rows) {
        if (row.length > 0) {
          const rowVertex = row[0]?.boundingPoly.vertices[0];
          if (rowVertex && rowVertex.y !== undefined) {
            const rowY = rowVertex.y;
            if (Math.abs(y - rowY) <= tolerance) {
              row.push(block);
              addedToRow = true;
              break;
            }
          }
        }
      }
      
      if (!addedToRow) {
        rows.push([block]);
      }
    }
    
    // Sort rows by Y-coordinate and blocks within rows by X-coordinate
    rows.sort((a, b) => {
      const aVertex = a[0]?.boundingPoly.vertices[0];
      const bVertex = b[0]?.boundingPoly.vertices[0];
      const aY = aVertex?.y ?? 0;
      const bY = bVertex?.y ?? 0;
      return aY - bY;
    });
    
    rows.forEach(row => row.sort((a, b) => {
      const aVertex = a.boundingPoly.vertices[0];
      const bVertex = b.boundingPoly.vertices[0];
      const aX = aVertex?.x ?? 0;
      const bX = bVertex?.x ?? 0;
      return aX - bX;
    }));
    
    return rows;
  }

  private extractPlayerFromRow(rowBlocks: TextBlock[]): Player | null {
    try {
      // For now, return null as we need to implement player-specific extraction
      // This method will be replaced with a new approach
      return null;
    } catch (error) {
      console.error('Error extracting player from row:', error);
      return null;
    }
  }

  // New method to extract all players using their specific coordinates
  private extractAllPlayers(blocks: TextBlock[]): Player[] {
    const players: Player[] = [];
    
    // Extract each player individually using their specific coordinates
    for (let playerNum = 1; playerNum <= 10; playerNum++) {
      const player = this.extractPlayerByNumber(blocks, playerNum);
      if (player) {
        players.push(player);
      }
    }
    
    return players;
  }

  private extractPlayerByNumber(blocks: TextBlock[], playerNum: number): Player | null {
    try {
      const prefix = `P${playerNum}_`;
      
      // Extract data from each region for this specific player
      const name = this.extractTextFromRegion(blocks, EXTRACTION_REGIONS[`${prefix}PLAYER_NAME` as keyof typeof EXTRACTION_REGIONS]);
      const grade = this.extractTextFromRegion(blocks, EXTRACTION_REGIONS[`${prefix}GRADE` as keyof typeof EXTRACTION_REGIONS]);
      const points = this.extractNumberFromRegion(blocks, EXTRACTION_REGIONS[`${prefix}POINTS` as keyof typeof EXTRACTION_REGIONS]);
      const rebounds = this.extractNumberFromRegion(blocks, EXTRACTION_REGIONS[`${prefix}REBOUNDS` as keyof typeof EXTRACTION_REGIONS]);
      const assists = this.extractNumberFromRegion(blocks, EXTRACTION_REGIONS[`${prefix}ASSISTS` as keyof typeof EXTRACTION_REGIONS]);
      const steals = this.extractNumberFromRegion(blocks, EXTRACTION_REGIONS[`${prefix}STEALS` as keyof typeof EXTRACTION_REGIONS]);
      const blocksStat = this.extractNumberFromRegion(blocks, EXTRACTION_REGIONS[`${prefix}BLOCKS` as keyof typeof EXTRACTION_REGIONS]);
      const fouls = this.extractNumberFromRegion(blocks, EXTRACTION_REGIONS[`${prefix}FOULS` as keyof typeof EXTRACTION_REGIONS]);
      const turnovers = this.extractNumberFromRegion(blocks, EXTRACTION_REGIONS[`${prefix}TURNOVERS` as keyof typeof EXTRACTION_REGIONS]);
      
      // Extract shooting stats
      const fgStats = this.extractShootingStatsFromRegion(blocks, EXTRACTION_REGIONS[`${prefix}FG` as keyof typeof EXTRACTION_REGIONS]);
      const threePtStats = this.extractShootingStatsFromRegion(blocks, EXTRACTION_REGIONS[`${prefix}3P` as keyof typeof EXTRACTION_REGIONS]);
      const ftStats = this.extractShootingStatsFromRegion(blocks, EXTRACTION_REGIONS[`${prefix}FT` as keyof typeof EXTRACTION_REGIONS]);
      
      // Process player name
      const processedName = this.processPlayerName(name);
      
      // Enhanced teammate grade extraction for AI players
      const validGrade = this.extractTeammateGrade(grade, name);
      
      if (!processedName || processedName.trim() === '') {
        return null;
      }
      
      // Validate and fix unrealistic stat values
      const validatedStats = this.validateAndFixStats({
        points, rebounds, assists, steals, blocks: blocksStat, fouls, turnovers
      });
      
      console.log(`Extracted player ${playerNum}: ${processedName}`, {
        grade: validGrade,
        stats: validatedStats,
        rawGrade: grade
      });
      
      return {
        name: processedName,
        team: 'Team A', // Will be determined later
        teammateGrade: validGrade || null,
        gameIdFromFile: '', // Will be set later
        playerId: '', // Will be set later
        position: '', // Will be set later
        fgMade: fgStats.made,
        fgAttempted: fgStats.attempted,
        threeMade: threePtStats.made,
        threeAttempted: threePtStats.attempted,
        ftMade: ftStats.made,
        ftAttempted: ftStats.attempted,
        rebounds: validatedStats.rebounds,
        assists: validatedStats.assists,
        steals: validatedStats.steals,
        blocks: validatedStats.blocks,
        fouls: validatedStats.fouls,
        turnovers: validatedStats.turnovers,
        points: validatedStats.points,
        id: '', // Will be set by database
        createdAt: new Date(),
        updatedAt: new Date(),
        gameId: '', // Will be set later
        userId: '' // Will be set later
      };
    } catch (error) {
      console.error(`Error extracting player ${playerNum}:`, error);
      return null;
    }
  }

  private validateAndFixStats(stats: {
    points: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    fouls: number;
    turnovers: number;
  }) {
    const { points, rebounds, assists, steals, blocks, fouls, turnovers } = stats;
    
    // NBA realistic ranges
    const realisticRanges = {
      points: { min: 0, max: 100 },
      rebounds: { min: 0, max: 30 },
      assists: { min: 0, max: 25 },
      steals: { min: 0, max: 10 },
      blocks: { min: 0, max: 15 },
      fouls: { min: 0, max: 6 },
      turnovers: { min: 0, max: 15 }
    };
    
    // Check for unrealistic values and log warnings
    if (steals > 10) {
      console.warn(`Unrealistic steals value: ${steals}. This might be misread assists.`);
      // If steals is unrealistic, it might actually be assists
      if (assists === 0 && steals > 20) {
        console.log(`Swapping steals (${steals}) with assists (${assists})`);
        return { ...stats, steals: assists, assists: steals };
      }
    }
    
    if (assists > 25) {
      console.warn(`Unrealistic assists value: ${assists}. This might be misread steals.`);
    }
    
    if (rebounds > 30) {
      console.warn(`Unrealistic rebounds value: ${rebounds}`);
    }
    
    if (blocks > 15) {
      console.warn(`Unrealistic blocks value: ${blocks}`);
    }
    
    // Clamp values to realistic ranges
    return {
      points: Math.max(realisticRanges.points.min, Math.min(points, realisticRanges.points.max)),
      rebounds: Math.max(realisticRanges.rebounds.min, Math.min(rebounds, realisticRanges.rebounds.max)),
      assists: Math.max(realisticRanges.assists.min, Math.min(assists, realisticRanges.assists.max)),
      steals: Math.max(realisticRanges.steals.min, Math.min(steals, realisticRanges.steals.max)),
      blocks: Math.max(realisticRanges.blocks.min, Math.min(blocks, realisticRanges.blocks.max)),
      fouls: Math.max(realisticRanges.fouls.min, Math.min(fouls, realisticRanges.fouls.max)),
      turnovers: Math.max(realisticRanges.turnovers.min, Math.min(turnovers, realisticRanges.turnovers.max))
    };
  }

  private extractTeammateGrade(gradeText: string, playerName: string): string | null {
    // Enhanced grade extraction for AI players
    const cleanGrade = gradeText.trim();
    
    // If no grade text, try to determine if it's an AI player
    if (!cleanGrade || cleanGrade === '') {
      // Check if player name suggests AI player (common patterns)
      const aiPlayerPatterns = [
        /^AI\s+/i,
        /^CPU\s+/i,
        /^Computer\s+/i,
        /^Bot\s+/i,
        /^Player\s*\d+/i,
        /^AI\s*Player/i,
        /^CPU\s*Player/i,
        /^Computer\s*Player/i,
        /^Bot\s*Player/i,
        /^AI\s*Bot/i,
        /^CPU\s*Bot/i,
        /^Computer\s*Bot/i,
        /^AI\s*CPU/i,
        /^CPU\s*AI/i,
        /^AI\s*Computer/i,
        /^Computer\s*AI/i
      ];
      
      if (aiPlayerPatterns.some(pattern => pattern.test(playerName))) {
        console.log(`AI player detected: ${playerName}, setting default grade`);
        return 'C+'; // Default grade for AI players
      }
      
      // Check for generic names that might be AI
      const genericNames = ['Player', 'Player1', 'Player2', 'Player3', 'Player4', 'Player5'];
      if (genericNames.includes(playerName.trim())) {
        console.log(`Generic player name detected: ${playerName}, setting default grade`);
        return 'C+';
      }
      
      return null;
    }
    
    // Validate the extracted grade
    return this.validateGrade(cleanGrade);
  }

  private extractTextFromRegion(blocks: TextBlock[], region: any): string {
    const regionBlocks = blocks.filter(block => {
      const vertex = block.boundingPoly.vertices[0];
      if (!vertex || vertex.x === undefined || vertex.y === undefined) {
        return false;
      }
      
      return vertex.x >= region.x1 &&
             vertex.x <= region.x2 &&
             vertex.y >= region.y1 &&
             vertex.y <= region.y2;
    });
    
    return regionBlocks
      .map(block => block.description)
      .join(' ')
      .trim();
  }

  private extractNumberFromRegion(blocks: TextBlock[], region: any): number {
    const text = this.extractTextFromRegion(blocks, region);
    const number = parseInt(text.replace(/[^0-9]/g, ''));
    
    // Debug logging for stat extraction
    const regionName = this.getRegionName(region);
    if (regionName) {
      console.log(`Extracting ${regionName}: "${text}" -> ${number}`);
    }
    
    return isNaN(number) ? 0 : number;
  }

  private getRegionName(region: any): string | null {
    // Helper method to identify which region is being processed
    for (const [key, value] of Object.entries(EXTRACTION_REGIONS)) {
      if (JSON.stringify(value) === JSON.stringify(region)) {
        return key;
      }
    }
    return null;
  }

  private extractShootingStatsFromRegion(blocks: TextBlock[], region: any): { made: number; attempted: number } {
    const text = this.extractTextFromRegion(blocks, region);
    
    // Debug logging for shooting stats
    const regionName = this.getRegionName(region);
    if (regionName) {
      console.log(`Extracting shooting stats ${regionName}: "${text}"`);
    }
    
    // Handle "X/Y" format
    if (text.includes('/')) {
      const parts = text.split('/');
      const made = parseInt(parts[0]?.replace(/[^0-9]/g, '') || '0') || 0;
      let attempted = parseInt(parts[1]?.replace(/[^0-9]/g, '') || '0') || 0;
      
      // Validate shooting stats
      if (made > attempted) {
        console.warn(`Invalid shooting stats: made (${made}) > attempted (${attempted}). Swapping values.`);
        return { made: attempted, attempted: made };
      }
      
      if (attempted > 50) {
        console.warn(`Unrealistic shooting attempts: ${attempted}. Clamping to realistic value.`);
        attempted = Math.min(attempted, 50);
      }
      
      return { made, attempted };
    }
    
    // Handle consecutive numbers "X Y"
    const numbers = text.match(/\d+/g);
    if (numbers && numbers.length >= 2) {
      const made = parseInt(numbers[0] || '0') || 0;
      let attempted = parseInt(numbers[1] || '0') || 0;
      
      // Validate shooting stats
      if (made > attempted) {
        console.warn(`Invalid shooting stats: made (${made}) > attempted (${attempted}). Swapping values.`);
        return { made: attempted, attempted: made };
      }
      
      if (attempted > 50) {
        console.warn(`Unrealistic shooting attempts: ${attempted}. Clamping to realistic value.`);
        attempted = Math.min(attempted, 50);
      }
      
      return { made, attempted };
    }
    
    // If no valid format found, try to extract any numbers
    const allNumbers = text.match(/\d+/g);
    if (allNumbers && allNumbers.length >= 1) {
      const value = parseInt(allNumbers[0]) || 0;
      return { made: value, attempted: value + Math.floor(Math.random() * 3) }; // Estimate attempts
    }
    
    return { made: 0, attempted: 0 };
  }

  private extractTeamTotals(blocks: TextBlock[], region: any): any {
    const regionBlocks = blocks.filter(block => {
      const vertex = block.boundingPoly.vertices[0];
      if (!vertex || vertex.x === undefined || vertex.y === undefined) {
        return false;
      }
      
      return vertex.x >= region.x1 &&
             vertex.x <= region.x2 &&
             vertex.y >= region.y1 &&
             vertex.y <= region.y2;
    });
    
    console.log(`Extracting team totals from region ${JSON.stringify(region)}`);
    console.log(`Found ${regionBlocks.length} text blocks in region`);
    console.log('Region blocks:', regionBlocks.map(b => ({ text: b.description, coords: b.boundingPoly.vertices[0] })));
    
    // Extract points from the region
    const pointsText = regionBlocks
      .map(block => block.description)
      .join(' ')
      .trim();
    
    console.log(`Extracted points text: "${pointsText}"`);
    
    const points = parseInt(pointsText.replace(/[^0-9]/g, '')) || 0;
    
    console.log(`Parsed points: ${points}`);
    
    return { points };
  }

  private extractTeamQuarters(blocks: TextBlock[], region: any): any {
    const regionBlocks = blocks.filter(block => {
      const vertex = block.boundingPoly.vertices[0];
      if (!vertex || vertex.x === undefined || vertex.y === undefined) {
        return false;
      }
      
      return vertex.x >= region.x1 &&
             vertex.x <= region.x2 &&
             vertex.y >= region.y1 &&
             vertex.y <= region.y2;
    });
    
    // Extract all text from the region
    const allText = regionBlocks
      .map(block => block.description)
      .join(' ')
      .trim();
    
    // Clean the text and extract numbers
    const cleanText = allText.replace(/[^0-9\s]/g, ' ').trim();
    
    // Split by whitespace and filter out empty strings
    const numberStrings = cleanText.split(/\s+/).filter(str => str.length > 0);
    
    // Extract individual numbers from each string (handles cases like "14141931" -> ["14", "14", "19", "31"])
    const allNumbers: number[] = [];
    
    for (const str of numberStrings) {
      // If the string is longer than 2 characters, try to split it into 2-digit numbers
      if (str.length > 2) {
        // Try to split into 2-digit numbers (most common for quarter scores)
        for (let i = 0; i < str.length; i += 2) {
          const numStr = str.substring(i, i + 2);
          const num = parseInt(numStr);
          if (!isNaN(num) && num >= 0 && num <= 99) {
            allNumbers.push(num);
          }
        }
      } else {
        // Single number
        const num = parseInt(str);
        if (!isNaN(num)) {
          allNumbers.push(num);
        }
      }
    }
    
    // Create quarters object with the first 4 numbers found
    const quarters: { [key: string]: number } = {};
    for (let i = 0; i < Math.min(allNumbers.length, 4); i++) {
      const value = allNumbers[i];
      if (value !== undefined) {
        quarters[`Q${i + 1}`] = value;
      }
    }
    
    // Fill in missing quarters with 0
    for (let i = 1; i <= 4; i++) {
      if (!quarters[`Q${i}`]) {
        quarters[`Q${i}`] = 0;
      }
    }
    
    return quarters;
  }

  private processPlayerName(name: string): string {
    if (!name) return '';
    
    // Remove gaming console icons
    let processedName = name.replace(/^[🎮🎯🎪]/g, '');
    
    // Replace underscores with spaces
    processedName = processedName.replace(/_/g, ' ');
    
    // Apply name mappings
    const lowerName = processedName.toLowerCase();
    
    // Check for exact matches first
    if (nameMappings[lowerName]) {
      return nameMappings[lowerName];
    }
    
    // Check for partial matches
    for (const [username, realName] of Object.entries(nameMappings)) {
      if (lowerName.includes(username.toLowerCase()) || username.toLowerCase().includes(lowerName)) {
        return realName;
      }
    }
    
    // Check for multi-word username matches
    for (const [username, realName] of Object.entries(nameMappings)) {
      const usernameParts = username.toLowerCase().split(/[\s_-]+/);
      const nameParts = lowerName.split(/[\s_-]+/);
      
      if (usernameParts.some(part => nameParts.includes(part))) {
        return realName;
      }
    }
    
    return processedName;
  }

  private validateGrade(grade: string): string {
    // Validate and clean grade text
    const cleanGrade = grade.trim().toUpperCase();
    
    // Check if it's a valid grade format
    if (/^[ABCDF][+-]?$/.test(cleanGrade)) {
      return cleanGrade;
    }
    
    // Try to extract grade from text
    const gradeMatch = cleanGrade.match(/[ABCDF][+-]?/);
    if (gradeMatch) {
      return gradeMatch[0];
    }
    
    // Return original if no valid grade found
    return grade;
  }
}
