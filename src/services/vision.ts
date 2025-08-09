import { ImageAnnotatorClient } from '@google-cloud/vision';
import { VisionApiResponse } from '@/types';

export class VisionService {
  private client: ImageAnnotatorClient;

  constructor() {
    const config: any = {};
    
    if (process.env.GOOGLE_CLOUD_PROJECT_ID) {
      config.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    }
    
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      config.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    
    this.client = new ImageAnnotatorClient(config);
  }

  async extractTextFromImage(imageBuffer: Buffer): Promise<VisionApiResponse[]> {
    try {
      const [result] = await this.client.textDetection(imageBuffer);
      const detections = result.textAnnotations || [];

      if (detections.length === 0) {
        throw new Error('No text detected in the image');
      }

      // Skip the first element as it contains the entire text
      const textBlocks = detections.slice(1).map(detection => ({
        text: detection.description || '',
        confidence: 0.9, // Google Vision doesn't provide confidence for text detection
        boundingBox: detection.boundingPoly ? {
          vertices: detection.boundingPoly.vertices?.map(vertex => ({
            x: vertex.x || 0,
            y: vertex.y || 0,
          })) || []
        } : null,
      }));

      return textBlocks;
    } catch (error) {
      console.error('Error extracting text from image:', error);
      throw new Error('Failed to extract text from image');
    }
  }

  async extractTextFromImageUrl(imageUrl: string): Promise<VisionApiResponse[]> {
    try {
      const [result] = await this.client.textDetection(imageUrl);
      const detections = result.textAnnotations || [];

      if (detections.length === 0) {
        throw new Error('No text detected in the image');
      }

      // Skip the first element as it contains the entire text
      const textBlocks = detections.slice(1).map(detection => ({
        text: detection.description || '',
        confidence: 0.9,
        boundingBox: detection.boundingPoly ? {
          vertices: detection.boundingPoly.vertices?.map(vertex => ({
            x: vertex.x || 0,
            y: vertex.y || 0,
          })) || []
        } : null,
      }));

      return textBlocks;
    } catch (error) {
      console.error('Error extracting text from image URL:', error);
      throw new Error('Failed to extract text from image URL');
    }
  }
}

export default new VisionService();
