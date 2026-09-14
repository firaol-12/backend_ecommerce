const { query } = require('./src/config/db');

async function addGoogleIdColumn() {
  try {
    console.log('Adding google_id column to users table...');
    
    // Check if column already exists
    const checkResult = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'google_id'
    `);
    
    if (checkResult.rowCount > 0) {
      console.log('- google_id column already exists');
      process.exit(0);
    }
    
    await query(`
      ALTER TABLE users ADD COLUMN google_id VARCHAR(255) UNIQUE
    `);
    
    console.log('✓ google_id column added successfully');
    process.exit(0);
  } catch (error) {
    console.error('Failed to add google_id column:', error);
    process.exit(1);
  }
}

addGoogleIdColumn();
