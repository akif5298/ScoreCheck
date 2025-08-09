# ScoreCheck 🏀

A comprehensive NBA 2K25 box score analysis application that extracts data from screenshots and provides detailed analytics.

## Features

- 📱 **Apple Integration**: Seamlessly import box score screenshots from your Apple account
- 🔍 **OCR Processing**: Extract player and team statistics using Google Cloud Vision API
- 📊 **Advanced Analytics**: View player averages, team performance, and detailed metrics
- 🎯 **Real-time Updates**: Track performance trends over time
- 📈 **Visual Dashboards**: Beautiful charts and graphs for data visualization
- 🔐 **Role-Based Access**: User and admin roles with different permissions
- 👑 **Admin Dashboard**: Master account access to manage all users and data
- 🔒 **iCloud 2FA Support**: Dedicated authentication page for Apple Sign-In

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL
- **Frontend**: React + TypeScript + Tailwind CSS
- **Image Processing**: Google Cloud Vision API
- **Authentication**: Apple Sign-In
- **Deployment**: Docker

## Quick Start

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables (see `.env.example`)
4. Set up the database: `npm run db:migrate`
5. Generate Prisma client: `npm run db:generate`
6. Set up admin user: `npm run db:setup-admin`
7. Run the development server: `npm run dev`

## Environment Variables

Create a `.env` file with the following variables:

```env
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/scorecheck

# Google Cloud Vision
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_CLOUD_PRIVATE_KEY=your-private-key
GOOGLE_CLOUD_CLIENT_EMAIL=your-client-email

# Apple Sign-In
APPLE_CLIENT_ID=your-apple-client-id
APPLE_TEAM_ID=your-apple-team-id
APPLE_PRIVATE_KEY=your-apple-private-key

# JWT Secret
JWT_SECRET=your-jwt-secret
```

## API Endpoints

### Authentication
- `POST /api/auth/apple` - Apple Sign-In authentication
- `POST /api/auth/verify` - Verify JWT token

### User Features
- `POST /api/screenshots/upload` - Upload box score screenshot
- `GET /api/players` - Get player statistics
- `GET /api/teams` - Get team statistics
- `GET /api/analytics` - Get analytics data

### Admin Features (Admin only)
- `GET /api/admin/users` - Get all users
- `GET /api/admin/games` - Get all games
- `DELETE /api/admin/games/:gameId` - Delete any game
- `DELETE /api/admin/users/:userId` - Delete any user
- `PATCH /api/admin/users/:userId/role` - Update user role
- `GET /api/admin/dashboard` - Get admin dashboard statistics

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License