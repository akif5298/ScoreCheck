#!/usr/bin/env python3
"""
Python OCR Wrapper for ScoreCheck Web App
This script provides preprocessing functionality for the enhanced OCR service
"""

import sys
import os
import cv2
import numpy as np
import argparse
from pathlib import Path

def preprocess_image_for_ocr(image_path: str, output_path: str = None) -> str:
    """
    Preprocess image for optimal OCR results using the same techniques
    from final_optimization_01_binary.py
    """
    try:
        # Load image
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Could not load image: {image_path}")
        
        print(f"Preprocessing image: {image_path}")
        
        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Apply CLAHE for contrast enhancement
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        enhanced = clahe.apply(gray)
        
        # Apply Otsu thresholding
        _, otsu = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # Apply morphological closing to clean up text
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        cleaned = cv2.morphologyEx(otsu, cv2.MORPH_CLOSE, kernel)
        
        # Light denoising
        denoised = cv2.medianBlur(cleaned, 1)
        
        # Invert for OCR (white text on black background)
        final = cv2.bitwise_not(denoised)
        
        # Save preprocessed image
        if output_path is None:
            # Create a unique filename to avoid overwriting input
            base_name = os.path.splitext(image_path)[0]
            output_path = f"{base_name}_preprocessed.png"
        
        cv2.imwrite(output_path, final)
        print(f"Preprocessed image saved to: {output_path}")
        
        return output_path
        
    except Exception as e:
        print(f"Error preprocessing image: {str(e)}")
        return None

def create_threshold_image(image_path: str, output_path: str = None) -> str:
    """
    Create threshold image specifically for turnover OCR (04_threshold variant)
    This matches the adaptive threshold strategy from final_optimization_01_binary.py
    """
    try:
        # Load image
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Could not load image: {image_path}")
        
        print(f"Creating threshold image: {image_path}")
        
        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Apply adaptive threshold (robust to shading) - this is the key for turnovers
        adaptive = cv2.adaptiveThreshold(
            gray, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            11, 2
        )
        
        # Save threshold image in uploads/thresholds/ folder
        if output_path is None:
            # Extract filename from the full path
            filename = os.path.basename(image_path)
            name_without_ext = os.path.splitext(filename)[0]
            
            # Create thresholds directory if it doesn't exist
            thresholds_dir = os.path.join("uploads", "thresholds")
            os.makedirs(thresholds_dir, exist_ok=True)
            
            # Save with same filename in thresholds folder
            output_path = os.path.join(thresholds_dir, f"{name_without_ext}.png")
            
            # Also print the exact output path for the Node.js system to find
            print(f"Output saved to: {output_path}")
        
        cv2.imwrite(output_path, adaptive)
        print(f"Threshold image saved to: {output_path}")
        
        return output_path
        
    except Exception as e:
        print(f"Error in threshold image creation: {str(e)}")
        return None

def create_enhanced_preprocessing(image_path: str, output_path: str = None) -> str:
    """
    Create enhanced preprocessing variant with different techniques
    for better OCR accuracy on challenging text
    """
    try:
        # Load image
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Could not load image: {image_path}")
        
        print(f"Creating enhanced preprocessing variant: {image_path}")
        
        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Apply stronger CLAHE for better contrast
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(16,16))
        enhanced = clahe.apply(gray)
        
        # Apply Gaussian blur to reduce noise
        blurred = cv2.GaussianBlur(enhanced, (3, 3), 0)
        
        # Apply adaptive thresholding for better text separation
        adaptive = cv2.adaptiveThreshold(
            blurred, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            21, 11
        )
        
        # Apply morphological opening to remove small artifacts
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2, 2))
        opened = cv2.morphologyEx(adaptive, cv2.MORPH_OPEN, kernel)
        
        # Apply morphological closing to connect text components
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        closed = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, kernel)
        
        # Invert for OCR (white text on black background)
        final = cv2.bitwise_not(closed)
        
        # Save enhanced preprocessed image
        if output_path is None:
            output_path = image_path.replace('.jpg', '_enhanced.png').replace('.jpeg', '_enhanced.png').replace('.png', '_enhanced.png')
        
        cv2.imwrite(output_path, final)
        print(f"Enhanced preprocessing saved to: {output_path}")
        
        return output_path
        
    except Exception as e:
        print(f"Error in enhanced preprocessing: {str(e)}")
        return None

def create_multi_level_preprocessing(image_path: str, output_path: str = None) -> str:
    """
    Create multi-level thresholding preprocessing variant
    This preserves more text information and might be better for rebounds/assists
    """
    try:
        # Load image
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Could not load image: {image_path}")
        
        print(f"Creating multi-level preprocessing variant: {image_path}")
        
        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Apply multi-level thresholding (preserve more text)
        _, thresh1 = cv2.threshold(gray, 50, 255, cv2.THRESH_BINARY)
        _, thresh2 = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)
        _, thresh3 = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
        
        # Combine thresholds to preserve more text information
        multi_level = cv2.bitwise_or(thresh1, thresh2)
        multi_level = cv2.bitwise_or(multi_level, thresh3)
        
        # Save multi-level preprocessed image
        if output_path is None:
            # Create a unique filename to avoid overwriting input
            base_name = os.path.splitext(image_path)[0]
            output_path = f"{base_name}_multilevel.png"
        
        cv2.imwrite(output_path, multi_level)
        print(f"Multi-level preprocessing saved to: {output_path}")
        
        return output_path
        
    except Exception as e:
        print(f"Error in multi-level preprocessing: {str(e)}")
        return None

def main():
    parser = argparse.ArgumentParser(description='Python OCR Preprocessing Wrapper')
    parser.add_argument('--input', '-i', required=True, help='Input image path')
    parser.add_argument('--output', '-o', help='Output image path (optional)')
    parser.add_argument('--preprocess-only', action='store_true', help='Only preprocess, no OCR')
    parser.add_argument('--enhanced', action='store_true', help='Use enhanced preprocessing variant')
    parser.add_argument('--threshold', action='store_true', help='Create threshold image for turnover OCR')
    parser.add_argument('--multilevel', action='store_true', help='Create multi-level thresholding variant for rebounds/assists')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input):
        print(f"❌ Input file does not exist: {args.input}")
        sys.exit(1)
    
    if args.threshold:
        # Create threshold image specifically for turnovers
        output_path = create_threshold_image(args.input, args.output)
        if output_path:
            print(f"Output saved to: {output_path}")
            sys.exit(0)
        else:
            sys.exit(1)
    elif args.multilevel:
        # Create multi-level preprocessing variant for rebounds/assists
        output_path = create_multi_level_preprocessing(args.input, args.output)
        if output_path:
            print(f"Output saved to: {output_path}")
            sys.exit(0)
        else:
            sys.exit(1)
    elif args.enhanced:
        # Use enhanced preprocessing
        output_path = create_enhanced_preprocessing(args.input, args.output)
        if output_path:
            print(f"Output saved to: {output_path}")
            sys.exit(0)
        else:
            sys.exit(1)
    elif args.preprocess_only:
        # Just preprocess the image
        output_path = preprocess_image_for_ocr(args.input, args.output)
        if output_path:
            print(f"Output saved to: {output_path}")
            sys.exit(0)
        else:
            sys.exit(1)
    else:
        # Preprocess and perform basic OCR test
        output_path = preprocess_image_for_ocr(args.input, args.output)
        if output_path:
            print(f"✅ Preprocessing completed successfully")
            print(f"Output saved to: {output_path}")
            sys.exit(0)
        else:
            print("❌ Preprocessing failed")
            sys.exit(1)

if __name__ == "__main__":
    main()
