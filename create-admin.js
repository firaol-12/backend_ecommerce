const { query } = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function createAdmin() {
  try {
    console.log('Creating admin user...');
    
    const email = 'admin@example.com';
    const password = 'Admin@123456';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await query(
      `INSERT INTO users (first_name, last_name, email, password, phone, role, is_active) 
       VALUES ($1, $2, $3, $4, $5, $6, true) 
       ON CONFLICT(email) DO NOTHING
       RETURNING id, email, role`,
      ['Admin', 'User', email, hashedPassword, null, 'admin']
    );
    
    if (result.rowCount > 0) {
      console.log('✓ Admin user created successfully');
      console.log(`Email: ${email}`);
      console.log(`Password: ${password}`);
      console.log('Use these credentials to login and access the admin dashboard');
    } else {
      console.log('- Admin user already exists');
      console.log('Email: admin@example.com');
      console.log('Try logging in with these credentials');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Failed to create admin user:', error);
    process.exit(1);
  }
}

createAdmin();
