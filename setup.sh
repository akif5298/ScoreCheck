#!/bin/bash

echo "🏀 Welcome to ScoreCheck Setup!"
echo "================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18 or higher."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm."
    exit 1
fi

echo "✅ Node.js and npm are installed"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install client dependencies
echo "📦 Installing client dependencies..."
cd client && npm install && cd ..

# Copy environment file
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp env.example .env
    echo "⚠️  Please update the .env file with your configuration values"
fi

# Check if Docker is installed
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "🐳 Docker and Docker Compose are available"
    echo "Would you like to use Docker for development? (y/n)"
    read -r use_docker
    
    if [[ $use_docker =~ ^[Yy]$ ]]; then
        echo "🚀 Starting with Docker..."
        docker-compose up -d db
        echo "⏳ Waiting for database to be ready..."
        sleep 10
        echo "🔄 Running database migrations..."
        docker-compose exec app npm run db:migrate
        echo "✅ Setup complete! Run 'docker-compose up' to start the application"
        exit 0
    fi
fi

# Check if PostgreSQL is installed locally
if command -v psql &> /dev/null; then
    echo "✅ PostgreSQL is available locally"
    echo "Please make sure PostgreSQL is running and create a database named 'scorecheck'"
    echo "Then update the DATABASE_URL in your .env file"
else
    echo "⚠️  PostgreSQL not found locally. You can:"
    echo "   1. Install PostgreSQL locally"
    echo "   2. Use Docker: docker-compose up -d db"
    echo "   3. Use a cloud database service"
fi

echo ""
echo "🎯 Next steps:"
echo "1. Update .env file with your configuration"
echo "2. Set up your database (PostgreSQL)"
echo "3. Run: npm run db:migrate"
echo "4. Run: npm run dev"
echo ""
echo "📚 For more information, check the README.md file"
echo ""
echo "🏀 Happy coding with ScoreCheck!"
