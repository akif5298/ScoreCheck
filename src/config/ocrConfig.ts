export interface OCRConfig {
  // Image preprocessing settings
  preprocessing: {
    enableGrayscale: boolean;
    contrastEnhancement: number;
    sharpeningSigma: number;
    noiseReduction: boolean;
    edgeEnhancement: boolean;
    binaryThreshold: number;
  };
  
  // OCR confidence thresholds
  confidence: {
    minimumThreshold: number;
    highConfidenceThreshold: number;
    mergeThreshold: number;
  };
  
  // Text validation rules
  validation: {
    enableTextCleaning: boolean;
    commonOCRReplacements: Record<string, string>;
    numericValidation: boolean;
    shootingStatsValidation: boolean;
  };
  
  // Coordinate tolerance settings
  coordinates: {
    rowGroupingTolerance: number;
    blockMergingTolerance: number;
    regionExpansion: number;
  };
}

export const defaultOCRConfig: OCRConfig = {
  preprocessing: {
    enableGrayscale: true,
    contrastEnhancement: 1.5,
    sharpeningSigma: 1.5,
    noiseReduction: true,
    edgeEnhancement: true,
    binaryThreshold: 128
  },
  
  confidence: {
    minimumThreshold: 0.3,
    highConfidenceThreshold: 0.8,
    mergeThreshold: 0.7
  },
  
  validation: {
    enableTextCleaning: true,
    commonOCRReplacements: {
      '|': 'I',
      '0': 'O',
      '1': 'I',
      '5': 'S',
      '8': 'B',
      '6': 'G',
      '9': 'g',
      'l': '1',
      'O': '0',
      'S': '5'
    },
    numericValidation: true,
    shootingStatsValidation: true
  },
  
  coordinates: {
    rowGroupingTolerance: 20,
    blockMergingTolerance: 10,
    regionExpansion: 5
  }
};

export const highAccuracyOCRConfig: OCRConfig = {
  ...defaultOCRConfig,
  preprocessing: {
    ...defaultOCRConfig.preprocessing,
    contrastEnhancement: 2.0,
    sharpeningSigma: 2.0,
    binaryThreshold: 120
  },
  confidence: {
    ...defaultOCRConfig.confidence,
    minimumThreshold: 0.5,
    highConfidenceThreshold: 0.9,
    mergeThreshold: 0.8
  },
  coordinates: {
    ...defaultOCRConfig.coordinates,
    rowGroupingTolerance: 15,
    blockMergingTolerance: 5,
    regionExpansion: 3
  }
};

export const fastOCRConfig: OCRConfig = {
  ...defaultOCRConfig,
  preprocessing: {
    ...defaultOCRConfig.preprocessing,
    noiseReduction: false,
    edgeEnhancement: false
  },
  confidence: {
    ...defaultOCRConfig.confidence,
    minimumThreshold: 0.2,
    mergeThreshold: 0.6
  }
};
