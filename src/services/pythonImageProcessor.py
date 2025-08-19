#!/usr/bin/env python3
"""
Python Image Processor for ScoreCheck
Handles image cropping, preprocessing, and optimization for OCR
"""

import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
import sys
import json
import base64
import io
import argparse
import os
from typing import Dict, Tuple, Any

class PythonImageProcessor:
    def __init__(self):
        self.nba_2k25_coordinates = {
            'left': 1214,
            'top': 430,
            'width': 2267,  # 3481 - 1214
            'height': 1209   # 1639 - 430
        }
        
        # Hardcoded test image path
        self.test_image_path = os.path.join(os.getcwd(), 'uploads', 'boxscore-1754761505428-225884003.JPEG')
    
    def test_with_hardcoded_image(self) -> Dict[str, Any]:
        """Test all operations with the hardcoded image"""
        try:
            if not os.path.exists(self.test_image_path):
                return {
                    'success': False, 
                    'error': f'Test image not found at: {self.test_image_path}'
                }
            
            # Read the hardcoded image
            with open(self.test_image_path, 'rb') as f:
                image_buffer = f.read()
            
            results = {}
            
            # Test cropping
            try:
                cropped = self.crop_box_score(image_buffer)
                results['crop_box_score'] = {
                    'success': True,
                    'size_bytes': len(cropped),
                    'data': base64.b64encode(cropped).decode('utf-8')
                }
            except Exception as e:
                results['crop_box_score'] = {
                    'success': False,
                    'error': str(e)
                }
            
            # Test preprocessing
            try:
                preprocessed = self.preprocess_for_ocr(image_buffer)
                results['preprocess_ocr'] = {
                    'success': True,
                    'size_bytes': len(preprocessed),
                    'data': base64.b64encode(preprocessed).decode('utf-8')
                }
            except Exception as e:
                results['preprocess_ocr'] = {
                    'success': False,
                    'error': str(e)
                }
            
            # Test dimensions
            try:
                dimensions = self.get_image_dimensions(image_buffer)
                results['dimensions'] = {
                    'success': True,
                    'data': dimensions
                }
            except Exception as e:
                results['dimensions'] = {
                    'success': False,
                    'error': str(e)
                }
            
            # Test multiple versions
            try:
                multiple_versions = self.create_multiple_versions(image_buffer)
                results['multiple_versions'] = {
                    'success': True,
                    'standard_size': len(multiple_versions['standard']),
                    'enhanced_size': len(multiple_versions['enhanced']),
                    'binary_size': len(multiple_versions['binary']),
                    'data': {
                        'standard': base64.b64encode(multiple_versions['standard']).decode('utf-8'),
                        'enhanced': base64.b64encode(multiple_versions['enhanced']).decode('utf-8'),
                        'binary': base64.b64encode(multiple_versions['binary']).decode('utf-8')
                    }
                }
            except Exception as e:
                results['multiple_versions'] = {
                    'success': False,
                    'error': str(e)
                }
            
            return {
                'success': True,
                'test_image_path': self.test_image_path,
                'original_image_size': len(image_buffer),
                'results': results
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f'Error testing with hardcoded image: {str(e)}'
            }
    
    def crop_image(self, image_buffer: bytes, coordinates: Dict[str, int]) -> bytes:
        """Crop image to specified coordinates"""
        try:
            # Convert bytes to numpy array
            nparr = np.frombuffer(image_buffer, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if img is None:
                raise ValueError("Failed to decode image")
            
            # Extract coordinates
            left = coordinates['left']
            top = coordinates['top']
            width = coordinates['width']
            height = coordinates['height']
            
            # Crop the image
            cropped = img[top:top+height, left:left+width]
            
            # Convert back to bytes
            _, buffer = cv2.imencode('.jpg', cropped, [cv2.IMWRITE_JPEG_QUALITY, 90])
            return buffer.tobytes()
            
        except Exception as e:
            raise Exception(f"Error cropping image: {str(e)}")
    
    def crop_box_score(self, image_buffer: bytes) -> bytes:
        """Crop image to NBA 2K25 box score specific coordinates"""
        return self.crop_image(image_buffer, self.nba_2k25_coordinates)
    
    def preprocess_for_ocr(self, image_buffer: bytes) -> bytes:
        """Enhanced preprocessing for OCR optimization"""
        try:
            # Convert bytes to PIL Image
            image = Image.open(io.BytesIO(image_buffer))
            
            # Convert to grayscale
            gray = image.convert('L')
            
            # Enhance contrast
            enhancer = ImageEnhance.Contrast(gray)
            enhanced = enhancer.enhance(1.5)
            
            # Apply sharpening filter
            sharpened = enhanced.filter(ImageFilter.SHARPEN)
            
            # Apply median filter to reduce noise
            denoised = sharpened.filter(ImageFilter.MedianFilter(size=3))
            
            # Enhance edges
            edge_enhanced = denoised.filter(ImageFilter.EDGE_ENHANCE)
            
            # Normalize brightness
            enhancer = ImageEnhance.Brightness(edge_enhanced)
            normalized = enhancer.enhance(1.1)
            
            # Convert back to bytes
            output = io.BytesIO()
            normalized.save(output, format='JPEG', quality=95, progressive=True, optimize=True)
            return output.getvalue()
            
        except Exception as e:
            raise Exception(f"Error preprocessing image for OCR: {str(e)}")
    
    def preprocess_for_ocr_alternative(self, image_buffer: bytes) -> bytes:
        """Alternative preprocessing method using different approach"""
        try:
            # Convert bytes to PIL Image
            image = Image.open(io.BytesIO(image_buffer))
            
            # Convert to grayscale
            gray = image.convert('L')
            
            # Apply gamma correction
            enhancer = ImageEnhance.Contrast(gray)
            gamma_corrected = enhancer.enhance(0.8)
            
            # Apply sharpening
            sharpened = gamma_corrected.filter(ImageFilter.SHARPEN)
            
            # Apply threshold to create binary image
            threshold = 128
            binary = sharpened.point(lambda x: 0 if x < threshold else 255, '1')
            
            # Convert back to bytes
            output = io.BytesIO()
            binary.save(output, format='PNG', optimize=True)
            return output.getvalue()
            
        except Exception as e:
            raise Exception(f"Error with alternative preprocessing: {str(e)}")
    
    def create_multiple_versions(self, image_buffer: bytes) -> Dict[str, bytes]:
        """Create multiple preprocessed versions for ensemble OCR"""
        try:
            standard = self.preprocess_for_ocr(image_buffer)
            enhanced = self.preprocess_for_ocr_alternative(image_buffer)
            
            # Create binary version
            image = Image.open(io.BytesIO(image_buffer))
            gray = image.convert('L')
            binary = gray.point(lambda x: 0 if x < 128 else 255, '1')
            
            output = io.BytesIO()
            binary.save(output, format='PNG', optimize=True)
            binary_bytes = output.getvalue()
            
            return {
                'standard': standard,
                'enhanced': enhanced,
                'binary': binary_bytes
            }
            
        except Exception as e:
            raise Exception(f"Error creating multiple versions: {str(e)}")
    
    def get_image_dimensions(self, image_buffer: bytes) -> Dict[str, int]:
        """Get image dimensions"""
        try:
            image = Image.open(io.BytesIO(image_buffer))
            return {
                'width': image.width,
                'height': image.height
            }
        except Exception as e:
            raise Exception(f"Error getting image dimensions: {str(e)}")
    
    def preprocess_binary_ocr(self, image_buffer: bytes, denoise: bool = False) -> Dict[str, bytes]:
        """Clean binary OCR preparation using the preferred method"""
        try:
            # Convert bytes to numpy array
            nparr = np.frombuffer(image_buffer, np.uint8)
            img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if img_bgr is None:
                raise ValueError("Failed to decode image")
            
            h, w = img_bgr.shape[:2]
            
            # 1) Deskew using near-horizontal lines
            gray_for_skew = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
            edges = cv2.Canny(gray_for_skew, 50, 150, apertureSize=3)
            lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=200,
                                    minLineLength=max(300, w // 5), maxLineGap=15)
            
            angle = 0.0
            if lines is not None and len(lines) > 0:
                angles = []
                for l in lines[:800]:
                    x1, y1, x2, y2 = l[0]
                    theta = np.degrees(np.arctan2((y2 - y1), (x2 - x1)))
                    if abs(theta) <= 15.0:  # keep near-horizontal
                        angles.append(theta)
                if angles:
                    angle = float(np.median(angles))
            
            # Rotate around center with border replication
            M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
            img_deskewed = cv2.warpAffine(img_bgr, M, (w, h), flags=cv2.INTER_LINEAR,
                                          borderMode=cv2.BORDER_REPLICATE)
            
            # 2) Grayscale
            gray = cv2.cvtColor(img_deskewed, cv2.COLOR_BGR2GRAY)
            
            # 3) Optional light denoise (median preserves edges)
            if denoise:
                gray = cv2.medianBlur(gray, 3)
            
            # 4) Contrast enhance (CLAHE)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            norm = clahe.apply(gray)
            
            # 5) Adaptive threshold (robust to shading)
            bin_bw = cv2.adaptiveThreshold(
                norm, 255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                31, 10
            )
            
            # 6) Invert -> white text on black background (OCR-friendly)
            binary_inv = 255 - bin_bw
            
            # Convert results to bytes
            results = {}
            
            # Binary for OCR (main output)
            _, binary_buffer = cv2.imencode('.png', binary_inv)
            results['binary_ocr'] = binary_buffer.tobytes()
            
            # Deskewed original
            _, deskewed_buffer = cv2.imencode('.jpg', img_deskewed, [cv2.IMWRITE_JPEG_QUALITY, 95])
            results['deskewed'] = deskewed_buffer.tobytes()
            
            # Contrast enhanced grayscale
            _, norm_buffer = cv2.imencode('.png', norm)
            results['enhanced_grayscale'] = norm_buffer.tobytes()
            
            # Original threshold (before inversion)
            _, thresh_buffer = cv2.imencode('.png', bin_bw)
            results['threshold'] = thresh_buffer.tobytes()
            
            return results
            
        except Exception as e:
            raise Exception(f"Error in binary OCR preprocessing: {str(e)}")
    
    def process_image(self, operation: str, image_buffer: bytes, **kwargs) -> Dict[str, Any]:
        """Main processing function that handles all operations"""
        try:
            if operation == 'test_hardcoded':
                return self.test_with_hardcoded_image()
            elif operation == 'crop':
                coordinates = kwargs.get('coordinates', self.nba_2k25_coordinates)
                result = self.crop_image(image_buffer, coordinates)
                return {'success': True, 'data': base64.b64encode(result).decode('utf-8')}
            
            elif operation == 'crop_box_score':
                result = self.crop_box_score(image_buffer)
                return {'success': True, 'data': base64.b64encode(result).decode('utf-8')}
            
            elif operation == 'preprocess_ocr':
                result = self.preprocess_for_ocr(image_buffer)
                return {'success': True, 'data': base64.b64encode(result).decode('utf-8')}
            
            elif operation == 'preprocess_ocr_alternative':
                result = self.preprocess_for_ocr_alternative(image_buffer)
                return {'success': True, 'data': base64.b64encode(result).decode('utf-8')}
            
            elif operation == 'multiple_versions':
                results = self.create_multiple_versions(image_buffer)
                encoded_results = {}
                for key, value in results.items():
                    encoded_results[key] = base64.b64encode(value).decode('utf-8')
                return {'success': True, 'data': encoded_results}
            
            elif operation == 'dimensions':
                result = self.get_image_dimensions(image_buffer)
                return {'success': True, 'data': result}
            
            elif operation == 'preprocess_binary_ocr':
                denoise = kwargs.get('denoise', False)
                result = self.preprocess_binary_ocr(image_buffer, denoise)
                encoded_results = {}
                for key, value in result.items():
                    encoded_results[key] = base64.b64encode(value).decode('utf-8')
                return {'success': True, 'data': encoded_results}
            
            else:
                return {'success': False, 'error': f'Unknown operation: {operation}'}
                
        except Exception as e:
            return {'success': False, 'error': str(e)}

def main():
    """Main function for command line usage"""
    parser = argparse.ArgumentParser(description='Python Image Processor for ScoreCheck')
    parser.add_argument('--operation', required=True, 
                       choices=['crop', 'crop_box_score', 'preprocess_ocr', 'preprocess_ocr_alternative', 'multiple_versions', 'dimensions', 'test_hardcoded', 'preprocess_binary_ocr'],
                       help='Image processing operation to perform')
    parser.add_argument('--input', help='Input image file path (not needed for test_hardcoded)')
    parser.add_argument('--output', help='Output image file path (optional)')
    parser.add_argument('--coordinates', help='Crop coordinates as JSON string')
    parser.add_argument('--denoise', action='store_true', help='Apply median blur for binary OCR preprocessing')
    
    args = parser.parse_args()
    
    try:
        # Initialize processor
        processor = PythonImageProcessor()
        
        if args.operation == 'test_hardcoded':
            # Test with hardcoded image
            result = processor.test_with_hardcoded_image()
            print(json.dumps(result, indent=2))
            return
        
        # For other operations, require input file
        if not args.input:
            print("Error: Input file is required for this operation")
            sys.exit(1)
        
        # Read input image
        with open(args.input, 'rb') as f:
            image_buffer = f.read()
        
        # Process image
        kwargs = {}
        if args.coordinates:
            kwargs['coordinates'] = json.loads(args.coordinates)
        if args.denoise:
            kwargs['denoise'] = args.denoise
        
        result = processor.process_image(args.operation, image_buffer, **kwargs)
        
        if result['success']:
            if args.output and 'data' in result:
                # Save output if specified
                if isinstance(result['data'], str):
                    # Decode base64 data
                    output_data = base64.b64decode(result['data'])
                    with open(args.output, 'wb') as f:
                        f.write(output_data)
                    print(f"Successfully processed image. Output saved to: {args.output}")
                else:
                    print("Operation completed successfully")
            else:
                print(json.dumps(result, indent=2))
        else:
            print(f"Error: {result['error']}")
            sys.exit(1)
            
    except Exception as e:
        print(f"Error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
