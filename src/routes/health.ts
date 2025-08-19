import { Router, Request, Response } from 'express';
import pythonImageProcessor from '@/services/pythonImageProcessorWrapper';

const router = Router();

// Health check endpoint to test Python image processing
router.get('/python-image-processing', async (req: Request, res: Response) => {
  try {
    // Check Python availability
    const pythonAvailable = await pythonImageProcessor.checkPythonAvailability();
    
    if (!pythonAvailable) {
      return res.status(503).json({
        success: false,
        error: 'Python is not available on the system',
        details: {
          pythonAvailable: false,
          pythonCommand: process.platform === 'win32' ? 'python' : 'python3'
        }
      });
    }

    // Check Python dependencies
    const dependencies = await pythonImageProcessor.checkPythonDependencies();
    
    if (!dependencies.available) {
      return res.status(503).json({
        success: false,
        error: 'Required Python packages are missing',
        details: {
          pythonAvailable: true,
          dependenciesAvailable: false,
          missingPackages: dependencies.missing
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Python image processing is working correctly',
      details: {
        pythonAvailable: true,
        dependenciesAvailable: true,
        pythonCommand: process.platform === 'win32' ? 'python' : 'python3'
      }
    });

  } catch (error) {
    console.error('Health check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Health check failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Test endpoint for hardcoded image processing
router.get('/test-hardcoded-image', async (req: Request, res: Response) => {
  try {
    // Check Python availability first
    const pythonAvailable = await pythonImageProcessor.checkPythonAvailability();
    
    if (!pythonAvailable) {
      return res.status(503).json({
        success: false,
        error: 'Python is not available on the system'
      });
    }

    // Test with hardcoded image
    const testResult = await pythonImageProcessor.testWithHardcodedImage();
    
    return res.status(200).json({
      success: true,
      message: 'Hardcoded image test completed',
      data: testResult
    });

  } catch (error) {
    console.error('Hardcoded image test error:', error);
    return res.status(500).json({
      success: false,
      error: 'Hardcoded image test failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
