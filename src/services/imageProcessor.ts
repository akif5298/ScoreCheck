import pythonImageProcessor from './pythonImageProcessorWrapper';
// Keep sharp as fallback option
import sharp from 'sharp';

export interface CropCoordinates {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class ImageProcessor {
  /**
   * Crop an image to the specified coordinates
   * @param imageBuffer - The input image buffer
   * @param coordinates - The crop coordinates
   * @returns Promise<Buffer> - The cropped image buffer
   */
  async cropImage(imageBuffer: Buffer, coordinates: CropCoordinates): Promise<Buffer> {
    try {
      return await pythonImageProcessor.cropImage(imageBuffer, coordinates);
    } catch (error) {
      console.error('Error cropping image with Python, falling back to Sharp:', error);
      try {
        // Fallback to Sharp
        const croppedImage = await sharp(imageBuffer)
          .extract({
            left: coordinates.left,
            top: coordinates.top,
            width: coordinates.width,
            height: coordinates.height,
          })
          .jpeg({ quality: 90 })
          .toBuffer();
        return croppedImage;
      } catch (sharpError) {
        console.error('Sharp fallback also failed:', sharpError);
        throw new Error('Failed to crop image with both Python and Sharp');
      }
    }
  }

  /**
   * Crop image to the specific NBA 2K25 box score coordinates
   * @param imageBuffer - The input image buffer
   * @returns Promise<Buffer> - The cropped image buffer
   */
  async cropBoxScore(imageBuffer: Buffer): Promise<Buffer> {
    try {
      return await pythonImageProcessor.cropBoxScore(imageBuffer);
    } catch (error) {
      console.error('Error cropping box score:', error);
      throw new Error('Failed to crop box score');
    }
  }

  /**
   * Enhanced preprocessing for OCR optimization
   * @param imageBuffer - The input image buffer
   * @returns Promise<Buffer> - The preprocessed image buffer
   */
  async preprocessForOCR(imageBuffer: Buffer): Promise<Buffer> {
    try {
      return await pythonImageProcessor.preprocessForOCR(imageBuffer);
    } catch (error) {
      console.error('Error preprocessing image for OCR:', error);
      // Fallback to original image if preprocessing fails
      return imageBuffer;
    }
  }

  /**
   * Alternative preprocessing method using different approach
   * @param imageBuffer - The input image buffer
   * @returns Promise<Buffer> - The preprocessed image buffer
   */
  async preprocessForOCRAlternative(imageBuffer: Buffer): Promise<Buffer> {
    try {
      return await pythonImageProcessor.preprocessForOCRAlternative(imageBuffer);
    } catch (error) {
      console.error('Error with alternative preprocessing:', error);
      return imageBuffer;
    }
  }

  /**
   * Create multiple preprocessed versions for ensemble OCR
   * @param imageBuffer - The input image buffer
   * @returns Promise<{standard: Buffer, enhanced: Buffer, binary: Buffer}> - Multiple preprocessed versions
   */
  async createMultipleVersions(imageBuffer: Buffer): Promise<{
    standard: Buffer;
    enhanced: Buffer;
    binary: Buffer;
  }> {
    try {
      return await pythonImageProcessor.createMultipleVersions(imageBuffer);
    } catch (error) {
      console.error('Error creating multiple versions:', error);
      throw new Error('Failed to create multiple versions');
    }
  }

  /**
   * Clean binary OCR preparation using the preferred method (exposes 04_threshold variant)
   * @param imageBuffer - The input image buffer
   * @param denoise - Optional median denoise flag
   * @returns Promise<{ binary_ocr: Buffer; deskewed: Buffer; enhanced_grayscale: Buffer; threshold: Buffer }>
   */
  async preprocessBinaryOCR(
    imageBuffer: Buffer,
    denoise: boolean = false
  ): Promise<{
    binary_ocr: Buffer;
    deskewed: Buffer;
    enhanced_grayscale: Buffer;
    threshold: Buffer;
  }> {
    try {
      const result = await pythonImageProcessor.preprocessBinaryOCR(imageBuffer, denoise);
      return result;
    } catch (error) {
      console.error('Error with binary OCR preprocessing:', error);
      throw new Error('Failed to preprocess with binary OCR method');
    }
  }

  /**
   * Get image dimensions
   * @param imageBuffer - The input image buffer
   * @returns Promise<{width: number, height: number}> - Image dimensions
   */
  async getImageDimensions(imageBuffer: Buffer): Promise<{ width: number; height: number }> {
    try {
      return await pythonImageProcessor.getImageDimensions(imageBuffer);
    } catch (error) {
      console.error('Error getting image dimensions:', error);
      throw new Error('Failed to get image dimensions');
    }
  }
}

export default new ImageProcessor();
