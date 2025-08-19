@echo off
echo Setting up Python environment for ScoreCheck image processing...

REM Check if Python 3 is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo Python is not installed or not in PATH. Please install Python 3.8 or higher first.
    echo Visit https://www.python.org/downloads/ for installation instructions.
    pause
    exit /b 1
)

REM Check Python version
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo Found Python version: %PYTHON_VERSION%

REM Check if pip is installed
pip --version >nul 2>&1
if errorlevel 1 (
    echo pip is not installed. Please install pip first.
    pause
    exit /b 1
)

REM Create virtual environment if it doesn't exist
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Upgrade pip
echo Upgrading pip...
python -m pip install --upgrade pip

REM Install Python dependencies
echo Installing Python dependencies...
pip install -r python_requirements.txt

REM Test if all packages are installed correctly
echo Testing Python packages...
python -c "import cv2; import PIL; import numpy; import skimage; print('✓ All required packages are installed successfully!'); print(f'  - OpenCV version: {cv2.__version__}'); print(f'  - Pillow version: {PIL.__version__}'); print(f'  - NumPy version: {numpy.__version__}'); print(f'  - scikit-image version: {skimage.__version__}')"

if errorlevel 1 (
    echo ✗ Some packages failed to install. Please check the error messages above.
    pause
    exit /b 1
) else (
    echo.
    echo ✓ Python environment setup completed successfully!
    echo.
    echo To activate the virtual environment in the future, run:
    echo   venv\Scripts\activate.bat
    echo.
    echo To deactivate, run:
    echo   deactivate
    echo.
    echo Note: The Node.js application will automatically use this Python environment.
)

pause
