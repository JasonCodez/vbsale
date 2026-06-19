const bcrypt = require('bcryptjs');
const db     = require('./database');

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin123';

try {
  const existing = db.getAdminUser(DEFAULT_USERNAME);
  const hash     = bcrypt.hashSync(DEFAULT_PASSWORD, 10);

  if (existing) {
    db.updateAdminPassword(DEFAULT_USERNAME, hash);
    console.log('Admin user already exists — password has been reset.');
  } else {
    db.createAdminUser(DEFAULT_USERNAME, hash);
    console.log('Admin user created.');
  }

  console.log('\n========================================');
  console.log('  Setup complete!');
  console.log('========================================');
  console.log('  Username: admin');
  console.log('  Password: admin123');
  console.log('========================================');
  console.log('\n  IMPORTANT: Change your password after');
  console.log('  your first login!');
  console.log('\n  Run "npm start" to launch the server.\n');
} catch (err) {
  console.error('Setup failed:', err.message);
  process.exit(1);
}
