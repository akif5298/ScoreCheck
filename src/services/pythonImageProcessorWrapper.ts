import { spawn } from 'child_process';
import path from 'path';

export interface CropCoordinates {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImageProcessingResult {
  success: boolean;
  data?: string | Record<string, string>;
  error?: string;
}

export class PythonImageProcessorWrapper {
  private pythonScriptPath: string;

  constructor() {
    // Path to the Python script relative to the project root
    this.pythonScriptPath = path.join(process.cwd(), 'src', 'services', 'pythonImageProcessor.py');
    
    // Detect OS and set appropriate Python command
    this.pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
  }

  private pythonCommand: string;

  /**
   * Execute Python script with given parameters
   */
  private async executePythonScript(
    operation: string,
    imageBuffer: Buffer,
    additionalArgs: string[] = []
  ): Promise<ImageProcessingResult> {
    return new Promise((resolve, reject) => {
      try {
        // Create a temporary file for the input image
        const fs = require('fs');
        const os = require('os');
        const tempInputPath = path.join(os.tmpdir(), `input_${Date.now()}.jpg`);
        const tempOutputPath = path.join(os.tmpdir(), `output_${Date.now()}.jpg`);

        // Write input image to temp file
        fs.writeFileSync(tempInputPath, imageBuffer);

        // Prepare command arguments
        const args = [
          this.pythonScriptPath,
          '--operation', operation,
          '--input', tempInputPath,
          '--output', tempOutputPath,
          ...additionalArgs
        ];

        // Spawn Python process
        const pythonProcess = spawn(this.pythonCommand, args);

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
          // Clean up temp files
          try {
            if (fs.existsSync(tempInputPath)) {
              fs.unlinkSync(tempInputPath);
            }
            if (fs.existsSync(tempOutputPath)) {
              fs.unlinkSync(tempOutputPath);
            }
          } catch (cleanupError) {
            console.warn('Warning: Could not clean up temp files:', cleanupError);
          }

          if (code === 0) {
            try {
              // Try to parse the output as JSON
              const result = JSON.parse(stdout.trim());
              resolve(result);
            } catch (parseError) {
              // If not JSON, assume it's a success message
              resolve({ success: true, data: stdout.trim() });
            }
          } else {
            reject(new Error(`Python script failed with code ${code}: ${stderr}`));
          }
        });

        pythonProcess.on('error', (error) => {
          reject(new Error(`Failed to start Python process: ${error.message}`));
        });

      } catch (error) {
        reject(new Error(`Error setting up Python process: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    });
  }

  /**
   * Crop an image to the specified coordinates
   */
  async cropImage(imageBuffer: Buffer, coordinates: CropCoordinates): Promise<Buffer> {
    try {
      const coordinatesJson = JSON.stringify(coordinates);
      const result = await this.executePythonScript('crop', imageBuffer, ['--coordinates', coordinatesJson]);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to crop image');
      }

      // Decode base64 data back to buffer
      return Buffer.from(result.data as string, 'base64');
    } catch (error) {
      console.error('Error cropping image with Python:', error);
      throw new Error('Failed to crop image with Python processor');
    }
  }

  /**
   * Crop image to the specific NBA 2K25 box score coordinates
   */
  async cropBoxScore(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const result = await this.executePythonScript('crop_box_score', imageBuffer);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to crop box score');
      }

      return Buffer.from(result.data as string, 'base64');
    } catch (error) {
      console.error('Error cropping box score with Python:', error);
      throw new Error('Failed to crop box score with Python processor');
    }
  }

  /**
   * Enhanced preprocessing for OCR optimization
   */
  async preprocessForOCR(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const result = await this.executePythonScript('preprocess_ocr', imageBuffer);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to preprocess image for OCR');
      }

      return Buffer.from(result.data as string, 'base64');
    } catch (error) {
      console.error('Error preprocessing image for OCR with Python:', error);
      throw new Error('Failed to preprocess image for OCR with Python processor');
    }
  }

  /**
   * Alternative preprocessing method using different approach
   */
  async preprocessForOCRAlternative(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const result = await this.executePythonScript('preprocess_ocr_alternative', imageBuffer);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to preprocess image with alternative method');
      }

      return Buffer.from(result.data as string, 'base64');
    } catch (error) {
      console.error('Error with alternative preprocessing using Python:', error);
      throw new Error('Failed to preprocess image with alternative method using Python processor');
    }
  }

  /**
   * Create multiple preprocessed versions for ensemble OCR
   */
  async createMultipleVersions(imageBuffer: Buffer): Promise<{
    standard: Buffer;
    enhanced: Buffer;
    binary: Buffer;
  }> {
    try {
      const result = await this.executePythonScript('multiple_versions', imageBuffer);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to create multiple versions');
      }

      const data = result.data as Record<string, string>;
      
      if (!data.standard || !data.enhanced || !data.binary) {
        throw new Error('Missing required image data from Python processor');
      }
      
      return {
        standard: Buffer.from(data.standard, 'base64'),
        enhanced: Buffer.from(data.enhanced, 'base64'),
        binary: Buffer.from(data.binary, 'base64'),
      };
    } catch (error) {
      console.error('Error creating multiple versions with Python:', error);
      throw new Error('Failed to create multiple versions with Python processor');
    }
  }

  /**
   * Get image dimensions
   */
  async getImageDimensions(imageBuffer: Buffer): Promise<{ width: number; height: number }> {
    try {
      const result = await this.executePythonScript('dimensions', imageBuffer);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to get image dimensions');
      }

      const data = result.data as any;
      if (typeof data.width !== 'number' || typeof data.height !== 'number') {
        throw new Error('Invalid image dimensions returned from Python processor');
      }
      return { width: data.width, height: data.height };
    } catch (error) {
      console.error('Error getting image dimensions with Python:', error);
      throw new Error('Failed to get image dimensions with Python processor');
    }
  }

  /**
   * Test all operations with the hardcoded image
   */
  async testWithHardcodedImage(): Promise<any> {
    try {
      const result = await this.executePythonScript('test_hardcoded', Buffer.alloc(0));
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to test with hardcoded image');
      }

      return result.data;
    } catch (error) {
      console.error('Error testing with hardcoded image:', error);
      throw new Error('Failed to test with hardcoded image');
    }
  }

  /**
   * Clean binary OCR preparation using the preferred method
   */
  async preprocessBinaryOCR(imageBuffer: Buffer, denoise: boolean = false): Promise<{
    binary_ocr: Buffer;
    deskewed: Buffer;
    enhanced_grayscale: Buffer;
    threshold: Buffer;
  }> {
    try {
      const additionalArgs = denoise ? ['--denoise'] : [];
      const result = await this.executePythonScript('preprocess_binary_ocr', imageBuffer, additionalArgs);
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to preprocess with binary OCR method');
      }

      const data = result.data as Record<string, string>;
      
      if (!data.binary_ocr || !data.deskewed || !data.enhanced_grayscale || !data.threshold) {
        throw new Error('Missing required preprocessing data from Python processor');
      }
      
      return {
        binary_ocr: Buffer.from(data.binary_ocr, 'base64'),
        deskewed: Buffer.from(data.deskewed, 'base64'),
        enhanced_grayscale: Buffer.from(data.enhanced_grayscale, 'base64'),
        threshold: Buffer.from(data.threshold, 'base64'),
      };
    } catch (error) {
      console.error('Error with binary OCR preprocessing:', error);
      throw new Error('Failed to preprocess with binary OCR method');
    }
  }

  /**
   * Check if Python is available and the script can be executed
   */
  async checkPythonAvailability(): Promise<boolean> {
    try {
      const { spawn } = require('child_process');
      const pythonProcess = spawn(this.pythonCommand, ['--version']);
      
      return new Promise((resolve) => {
        pythonProcess.on('close', (code: number) => {
          resolve(code === 0);
        });
        
        pythonProcess.on('error', () => {
          resolve(false);
        });
      });
    } catch (error) {
      return false;
      }
  }

  /**
   * Check if required Python packages are installed
   */
  async checkPythonDependencies(): Promise<{ available: boolean; missing: string[] }> {
    try {
      const { spawn } = require('child_process');
      const pythonProcess = spawn(this.pythonCommand, [
        '-c',
        'import cv2, PIL, numpy, skimage; print("All packages available")'
      ]);
      
      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        
        pythonProcess.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        
        pythonProcess.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
        
        pythonProcess.on('close', (code: number) => {
          if (code === 0) {
            resolve({ available: true, missing: [] });
          } else {
            // Try to identify missing packages
            const missing: string[] = [];
            if (stderr.includes('cv2')) missing.push('opencv-python');
            if (stderr.includes('PIL')) missing.push('Pillow');
            if (stderr.includes('numpy')) missing.push('numpy');
            if (stderr.includes('skimage')) missing.push('scikit-image');
            
            resolve({ available: false, missing });
          }
        });
        
        pythonProcess.on('error', () => {
          resolve({ available: false, missing: [this.pythonCommand] });
        });
      });
    } catch (error) {
      return { available: false, missing: [this.pythonCommand] };
    }
  }
}

export default new PythonImageProcessorWrapper();
