import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import toast from 'react-hot-toast';
import { UploadIcon, XIcon, CheckIcon } from '@heroicons/react/outline';

const Upload: React.FC = () => {
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setUploadedFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif']
    },
    multiple: false,
    maxSize: 10 * 1024 * 1024, // 10MB
  });

  const handleUpload = async () => {
    if (!uploadedFile) {
      toast.error('Please select a file first');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('screenshot', uploadedFile);

    try {
      const response = await axios.post('/api/screenshots/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data.success) {
        toast.success('Box score uploaded and processed successfully!');
        setUploadedFile(null);
        setPreview(null);
      } else {
        throw new Error(response.data.error || 'Upload failed');
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.response?.data?.error || 'Failed to upload screenshot');
    } finally {
      setUploading(false);
    }
  };

  const removeFile = () => {
    setUploadedFile(null);
    setPreview(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Upload Box Score</h1>
        <p className="text-gray-600">Upload a screenshot of your NBA 2K25 box score to extract and analyze the data</p>
      </div>

      {/* Upload Area */}
      <div className="card">
        <div className="space-y-4">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors duration-200 ${
              isDragActive
                ? 'border-primary-400 bg-primary-50'
                : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
            }`}
          >
            <input {...getInputProps()} />
            <UploadIcon className="mx-auto h-12 w-12 text-gray-400" />
            <div className="mt-4">
              {isDragActive ? (
                <p className="text-primary-600">Drop the screenshot here...</p>
              ) : (
                <div>
                  <p className="text-gray-600">
                    Drag and drop a screenshot here, or{' '}
                    <span className="text-primary-600 hover:text-primary-500">
                      click to select
                    </span>
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    Supports JPG, PNG, GIF up to 10MB
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* File Preview */}
          {uploadedFile && (
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                    <CheckIcon className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{uploadedFile.name}</p>
                    <p className="text-sm text-gray-500">
                      {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>
                <button
                  onClick={removeFile}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors duration-200"
                >
                  <XIcon className="w-5 h-5" />
                </button>
              </div>
              
              {/* Image Preview */}
              {preview && (
                <div className="mt-4">
                  <img
                    src={preview}
                    alt="Preview"
                    className="max-w-full h-64 object-contain rounded-lg border border-gray-200"
                  />
                </div>
              )}
            </div>
          )}

          {/* Upload Button */}
          {uploadedFile && (
            <div className="flex justify-end">
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {uploading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <UploadIcon className="w-4 h-4" />
                    <span>Upload & Process</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">How to get the best results</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-gray-900 mb-2">📱 Screenshot Tips</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Take a clear, high-resolution screenshot</li>
              <li>• Ensure all text is readable and not cut off</li>
              <li>• Include the complete box score section</li>
              <li>• Avoid blurry or distorted images</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 mb-2">🔍 What we extract</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Player names and statistics</li>
              <li>• Team scores and totals</li>
              <li>• Shooting percentages</li>
              <li>• Game date and teams</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Demo Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 mb-2">
          🚀 Demo Mode
        </h3>
        <p className="text-sm text-blue-700">
          This is a demo version. The upload will simulate processing and show you how the app would work with real box score screenshots.
        </p>
      </div>
    </div>
  );
};

export default Upload;
