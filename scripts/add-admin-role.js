const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database migration...');

  try {
      // Since we're using SQLite with string roles and default values, 
  // we don't need to update existing users
  console.log('Checking for existing users...');
  const existingUsers = await prisma.user.findMany();
  console.log(`Found ${existingUsers.length} existing users`);

    // Create a default admin user if it doesn't exist
    console.log('Creating default admin user...');
    const adminEmail = 'admin@scorecheck.com';
    
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (!existingAdmin) {
      await prisma.user.create({
        data: {
          email: adminEmail,
          name: 'Admin User',
          appleId: 'admin_apple_id',
          role: 'ADMIN',
        },
      });
      console.log('Default admin user created successfully!');
    } else {
      // Update existing admin user to have ADMIN role
      await prisma.user.update({
        where: { email: adminEmail },
        data: { role: 'ADMIN' },
      });
      console.log('Existing admin user updated with ADMIN role!');
    }

    console.log('Database migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
