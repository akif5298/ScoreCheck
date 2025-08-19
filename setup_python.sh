#!/bin/bash

echo "Setting up Python environment for ScoreCheck image processing..."

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "Python 3 is not installed. Please install Python 3.8 or higher first."
    echo "Visit https://www.python.org/downloads/ for installation instructions."
    exit 1
fi

# Check Python version
PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
echo "Found Python version: $PYTHON_VERSION"

# Check if pip is installed
if ! command -v pip3 &> /dev/null; then
    echo "pip3 is not installed. Please install pip3 first."
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -r python_requirements.txt

# Test if all packages are installed correctly
echo "Testing Python packages..."
python3 -c "
import cv2
import PIL
import numpy
import skimage
print('✓ All required packages are installed successfully!')
print(f'  - OpenCV version: {cv2.__version__}')
print(f'  - Pillow version: {PIL.__version__}')
print(f'  - NumPy version: {numpy.__version__}')
print(f'  - scikit-image version: {skimage.__version__}')
"

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Python environment setup completed successfully!"
    echo ""
    echo "To activate the virtual environment in the future, run:"
    echo "  source venv/bin/activate"
    echo ""
    echo "To deactivate, run:"
    echo "  deactivate"
    echo ""
    echo "Note: The Node.js application will automatically use this Python environment."
else
    echo "✗ Some packages failed to install. Please check the error messages above."
    exit 1
fi
